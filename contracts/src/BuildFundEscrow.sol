// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    IMUSDSavingsRate,
    IPCV,
    IBorrowerOperationsSignatures,
    ITroveManager,
    IPriceFeed,
    IMezoRouter
} from "./interfaces/IMezo.sol";

/// @title Veridom Build Fund — per-project construction escrow on Mezo
/// @author Veridom (veridom.space)
/// @notice Holds a homeowner's construction budget in MUSD and pays the contractor stage by
///         stage (instalment plan / "Ratenplan"). While money waits for its stage it sits in
///         the MUSD Savings Rate vault (sMUSD) and earns protocol yield for the homeowner.
///
///         Money can come in three ways:
///         1. `fund` / `fundWithPermit`: plain MUSD from any wallet.
///         2. `drawFromTrove`: the homeowner signs an EIP-712 message once and the MUSD protocol
///            mints new MUSD against her BTC trove *directly into this escrow* (borrow only what
///            the build needs, when it needs it). An optional on-chain guard rejects any draw
///            that would leave her trove below a collateral ratio she chose.
///         3. Leftover money can go back the same way: `repayTroveFromFree` burns unused budget
///            against her trove debt via the MUSD signature entry point.
///
///         Stage release rules (all enforced on-chain):
///         - The contractor requests a stage with an evidence hash (Veridom checkpoint record).
///         - The stage becomes payable when the homeowner approves AND, if an inspector is
///           configured, the inspector signs off.
///         - If the homeowner stays silent for the whole review window, the stage is deemed
///           accepted (the inspector sign-off is still required when configured).
///         - Either side can dispute; a pre-agreed arbiter splits the disputed stage.
///         - After a stage's deadline, an unrequested stage can be cancelled by the homeowner
///           and its money becomes free again.
///         - A retention (e.g. 2 % as in the Austrian BTVG Ratenplan) is withheld from every
///           payment and released after the warranty period, or earlier by the homeowner.
///
///         The contract has no owner and no upgrade path: nobody, including Veridom, can move
///         the money outside of these rules.
contract BuildFundEscrow is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    enum StageStatus {
        Pending, // 0 — waiting for the contractor
        Requested, // 1 — contractor says "done", review window running
        Rejected, // 2 — homeowner or inspector found defects, contractor must fix and re-request
        Approved, // 3 — all required sign-offs given, contractor can claim
        Disputed, // 4 — frozen until the arbiter decides
        Paid, // 5 — settled (fully or partially after a dispute)
        Cancelled // 6 — cancelled after its deadline, money returned to the free balance
    }

    enum PayoutAsset {
        MUSD,
        BTC
    }

    struct Stage {
        string name;
        uint128 amount; // gross MUSD for this stage (retention is taken out of it on payment)
        uint64 deadline; // the contractor must request the stage before this time
        uint64 requestedAt;
        StageStatus status;
        bool homeownerApproved;
        bool inspectorApproved;
        bytes32 evidenceHash; // hash of the Veridom checkpoint record (photos, signatures)
        uint128 paidToContractor; // net amount paid out (after retention)
    }

    struct StageInput {
        string name;
        uint128 amount;
        uint64 deadline;
    }

    struct Roles {
        address homeowner;
        address contractor;
        address inspector; // optional (address(0) = no independent inspection)
        address arbiter; // decides disputes
    }

    struct Terms {
        uint32 reviewWindow; // seconds the homeowner has to react to a stage request
        uint16 retentionBps; // withheld from each payment, e.g. 200 = 2 %
        uint32 warrantyPeriod; // seconds after completion until retention can be released
        uint64 minIcrAfterDraw; // 1e18 = 100 %; 0 disables the trove draw guard
        string title;
        string metadataURI; // link to the Veridom project record
    }

    struct Protocol {
        address musd;
        address savingsVault;
        address pcv;
        address borrowerOpsSignatures;
        address troveManager;
        address priceFeed;
        address router;
        address poolFactory;
        address btc;
    }

    // ------------------------------------------------------------------ constants

    uint256 public constant MAX_STAGES = 20;
    uint256 public constant MAX_RETENTION_BPS = 1_000; // 10 %
    uint256 public constant MAX_REVIEW_WINDOW = 30 days;
    uint256 public constant MAX_WARRANTY = 5 * 365 days;
    uint256 private constant BPS = 10_000;

    // ------------------------------------------------------------------ storage

    address public factory;
    Roles public roles;
    Terms public terms;
    Protocol public protocol;

    Stage[] internal _stages;

    bool public contractorAccepted;
    /// @notice MUSD principal currently parked in the Savings Rate vault (1 sMUSD = 1 MUSD principal).
    uint256 public principal;
    /// @notice Sum of gross amounts of stages that are not yet Paid or Cancelled.
    uint256 public committed;
    /// @notice Retention withheld from payments, released after the warranty period.
    uint256 public retentionHeld;
    /// @notice Lifetime totals, for reporting.
    uint256 public totalFunded;
    uint256 public totalDrawnFromTrove;
    uint256 public totalPaidToContractor;
    uint256 public totalYieldPaid;
    uint256 public totalRepaidToTrove;

    uint64 public completedAt;
    bool public retentionDisputed;

    // ------------------------------------------------------------------ events

    event ProjectInitialized(
        address indexed homeowner, address indexed contractor, address inspector, address arbiter
    );
    event ContractorAccepted(address indexed contractor);
    event Funded(address indexed from, uint256 amount, bool fromTrove);
    event StageRequested(uint256 indexed stageId, bytes32 evidenceHash);
    event StageApprovedByHomeowner(uint256 indexed stageId);
    event StageInspected(uint256 indexed stageId, bool passed, bytes32 noteHash);
    event StageRejected(uint256 indexed stageId, address indexed by, bytes32 reasonHash);
    event StageReady(uint256 indexed stageId);
    event StageDisputed(uint256 indexed stageId, address indexed by, bytes32 reasonHash);
    event DisputeResolved(uint256 indexed stageId, uint256 toContractor, uint256 freed);
    event StagePaid(
        uint256 indexed stageId, uint256 net, uint256 retention, PayoutAsset asset, uint256 amountOut
    );
    event StageCancelled(uint256 indexed stageId, uint256 amount);
    event ProjectCompleted(uint64 completedAt);
    event RetentionDisputed(bytes32 reasonHash);
    event RetentionReleased(uint256 toContractor, uint256 toHomeowner);
    event FreeWithdrawn(address indexed to, uint256 amount);
    event TroveRepaid(uint256 amount);
    event YieldPaid(address indexed to, uint256 amount);
    event DrawGuardUpdated(uint64 minIcrAfterDraw);

    // ------------------------------------------------------------------ errors

    error NotHomeowner();
    error NotContractor();
    error NotInspector();
    error NotArbiter();
    error NotParty();
    error InvalidRoles();
    error InvalidTerms();
    error InvalidStages();
    error InvalidStage();
    error WrongStatus(StageStatus status);
    error NotAccepted();
    error AlreadyAccepted();
    error ReviewWindowOver();
    error NotYetClaimable();
    error DeadlineNotPassed();
    error InsufficientFunds(uint256 needed, uint256 available);
    error ZeroAmount();
    error AmountTooLarge();
    error MinOutRequired();
    error DrawGuard(uint256 icrAfter, uint256 minIcr);
    error DrawMismatch(uint256 received, uint256 expected);
    error RepayMismatch(uint256 burned, uint256 expected);
    error NotCompleted();
    error RetentionLocked();
    error RetentionIsDisputed();
    error RetentionNotDisputed();
    error NothingToRelease();
    error NoBtcAccepted();

    // ------------------------------------------------------------------ modifiers

    modifier onlyHomeowner() {
        if (msg.sender != roles.homeowner) revert NotHomeowner();
        _;
    }

    modifier onlyContractor() {
        if (msg.sender != roles.contractor) revert NotContractor();
        _;
    }

    modifier onlyArbiter() {
        if (msg.sender != roles.arbiter) revert NotArbiter();
        _;
    }

    modifier validStage(uint256 stageId) {
        if (stageId >= _stages.length) revert InvalidStage();
        _;
    }

    // ------------------------------------------------------------------ init

    /// @dev Implementation contract is locked; clones are initialised by the factory.
    constructor() {
        _disableInitializers();
    }

    function initialize(
        Protocol calldata protocol_,
        Roles calldata roles_,
        Terms calldata terms_,
        StageInput[] calldata stages_
    ) external initializer {
        if (
            roles_.homeowner == address(0) || roles_.contractor == address(0)
                || roles_.arbiter == address(0) || roles_.homeowner == roles_.contractor
                || roles_.arbiter == roles_.homeowner || roles_.arbiter == roles_.contractor
                || roles_.inspector == roles_.homeowner || roles_.inspector == roles_.contractor
        ) revert InvalidRoles();
        if (
            terms_.reviewWindow == 0 || terms_.reviewWindow > MAX_REVIEW_WINDOW
                || terms_.retentionBps > MAX_RETENTION_BPS || terms_.warrantyPeriod > MAX_WARRANTY
                || (terms_.minIcrAfterDraw != 0 && terms_.minIcrAfterDraw < 1.1e18)
        ) revert InvalidTerms();
        uint256 n = stages_.length;
        if (n == 0 || n > MAX_STAGES) revert InvalidStages();

        factory = msg.sender;
        protocol = protocol_;
        roles = roles_;
        terms = terms_;

        uint256 total;
        for (uint256 i; i < n; ++i) {
            StageInput calldata s = stages_[i];
            if (s.amount == 0 || bytes(s.name).length == 0 || bytes(s.name).length > 64) {
                revert InvalidStages();
            }
            if (s.deadline <= block.timestamp) revert InvalidStages();
            if (i > 0 && s.deadline < stages_[i - 1].deadline) revert InvalidStages();
            _stages.push(
                Stage({
                    name: s.name,
                    amount: s.amount,
                    deadline: s.deadline,
                    requestedAt: 0,
                    status: StageStatus.Pending,
                    homeownerApproved: false,
                    inspectorApproved: false,
                    evidenceHash: bytes32(0),
                    paidToContractor: 0
                })
            );
            total += s.amount;
        }
        committed = total;
        emit ProjectInitialized(
            roles_.homeowner, roles_.contractor, roles_.inspector, roles_.arbiter
        );
    }

    /// @dev The MUSD protocol's ActivePool sends the (zero) collateral withdrawal of a debt-only
    ///      adjustment to the signature's recipient with a plain call, so `drawFromTrove` needs a
    ///      receive hook. The escrow never holds BTC: any non-zero amount is refused.
    receive() external payable {
        if (msg.value != 0) revert NoBtcAccepted();
    }

    // ------------------------------------------------------------------ funding

    /// @notice Add MUSD to the build budget. Anyone can fund (homeowner, family, a bank).
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(protocol.musd).safeTransferFrom(msg.sender, address(this), amount);
        _depositToVault(amount);
        totalFunded += amount;
        emit Funded(msg.sender, amount, false);
    }

    /// @notice Same as `fund`, with an EIP-2612 permit so no separate approval tx is needed.
    function fundWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        // A front-run permit would make this call fail; tolerate it if allowance is already set.
        try IERC20Permit(protocol.musd).permit(msg.sender, address(this), amount, deadline, v, r, s)
        {} catch {}
        IERC20(protocol.musd).safeTransferFrom(msg.sender, address(this), amount);
        _depositToVault(amount);
        totalFunded += amount;
        emit Funded(msg.sender, amount, false);
    }

    /// @notice Borrow `amount` new MUSD against the homeowner's Mezo trove straight into this
    ///         escrow. The homeowner authorises it with an EIP-712 `WithdrawMUSD` signature
    ///         (recipient = this escrow), so anyone may submit it — the money can only land here.
    /// @dev Reverts if the homeowner's collateral ratio after the draw is below the guard she set.
    function drawFromTrove(
        uint256 amount,
        address upperHint,
        address lowerHint,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20 musd = IERC20(protocol.musd);
        uint256 balBefore = musd.balanceOf(address(this));
        IBorrowerOperationsSignatures(protocol.borrowerOpsSignatures).withdrawMUSDWithSignature(
            amount, upperHint, lowerHint, roles.homeowner, address(this), signature, deadline
        );
        uint256 received = musd.balanceOf(address(this)) - balBefore;
        if (received != amount) revert DrawMismatch(received, amount);

        uint64 minIcr = terms.minIcrAfterDraw;
        if (minIcr != 0) {
            uint256 icr = homeownerICR();
            if (icr < minIcr) revert DrawGuard(icr, minIcr);
        }

        _depositToVault(amount);
        totalFunded += amount;
        totalDrawnFromTrove += amount;
        emit Funded(roles.homeowner, amount, true);
    }

    /// @notice The homeowner can tighten or relax the trove draw guard (0 disables it).
    function setDrawGuard(uint64 minIcrAfterDraw) external onlyHomeowner {
        if (minIcrAfterDraw != 0 && minIcrAfterDraw < 1.1e18) revert InvalidTerms();
        terms.minIcrAfterDraw = minIcrAfterDraw;
        emit DrawGuardUpdated(minIcrAfterDraw);
    }

    // ------------------------------------------------------------------ contractor flow

    /// @notice The contractor accepts the instalment plan and terms. Required before requests.
    function acceptProject() external onlyContractor {
        if (contractorAccepted) revert AlreadyAccepted();
        contractorAccepted = true;
        emit ContractorAccepted(msg.sender);
    }

    /// @notice The contractor reports a stage as complete, attaching the hash of the evidence
    ///         (Veridom checkpoint: photos, measurements, both-party signatures).
    function requestRelease(uint256 stageId, bytes32 evidenceHash)
        external
        onlyContractor
        validStage(stageId)
    {
        if (!contractorAccepted) revert NotAccepted();
        Stage storage s = _stages[stageId];
        if (s.status != StageStatus.Pending && s.status != StageStatus.Rejected) {
            revert WrongStatus(s.status);
        }
        s.status = StageStatus.Requested;
        s.requestedAt = uint64(block.timestamp);
        s.evidenceHash = evidenceHash;
        s.homeownerApproved = false;
        s.inspectorApproved = false;
        emit StageRequested(stageId, evidenceHash);
    }

    /// @notice Pay out a stage once it is approved (or deemed accepted after the review window).
    /// @param asset MUSD, or BTC via the Mezo MUSD/BTC pool (swap with `minOut` protection).
    function claim(uint256 stageId, PayoutAsset asset, uint256 minOut)
        external
        nonReentrant
        onlyContractor
        validStage(stageId)
    {
        Stage storage s = _stages[stageId];
        if (!_isClaimable(s)) revert NotYetClaimable();
        if (asset == PayoutAsset.BTC && minOut == 0) revert MinOutRequired();

        uint256 gross = s.amount;
        uint256 retention = (gross * terms.retentionBps) / BPS;
        uint256 net = gross - retention;
        uint256 available = _spendable();
        if (available < gross) revert InsufficientFunds(gross, available);

        // effects
        s.status = StageStatus.Paid;
        // net <= gross, and gross was stored as uint128
        // forge-lint: disable-next-line(unsafe-typecast)
        s.paidToContractor = uint128(net);
        committed -= gross;
        retentionHeld += retention;
        // only `net` leaves the vault; the retention stays there, ring-fenced by `retentionHeld`
        principal -= net;
        totalPaidToContractor += net;
        _maybeComplete();

        // interactions
        _withdrawFromVault(net);
        uint256 out = _payContractor(net, asset, minOut);
        emit StagePaid(stageId, net, retention, asset, out);
    }

    // ------------------------------------------------------------------ homeowner / inspector

    /// @notice Homeowner signs off the stage (Abnahme).
    function approve(uint256 stageId) external onlyHomeowner validStage(stageId) {
        Stage storage s = _stages[stageId];
        if (s.status != StageStatus.Requested) revert WrongStatus(s.status);
        s.homeownerApproved = true;
        emit StageApprovedByHomeowner(stageId);
        _maybeReady(stageId, s);
    }

    /// @notice Independent inspector (e.g. Ziviltechniker / Bausachverständiger) records the
    ///         result of the site inspection for a requested stage.
    function inspect(uint256 stageId, bool passed, bytes32 noteHash) external validStage(stageId) {
        if (msg.sender != roles.inspector) revert NotInspector();
        Stage storage s = _stages[stageId];
        if (s.status != StageStatus.Requested) revert WrongStatus(s.status);
        emit StageInspected(stageId, passed, noteHash);
        if (passed) {
            s.inspectorApproved = true;
            _maybeReady(stageId, s);
        } else {
            s.status = StageStatus.Rejected;
            emit StageRejected(stageId, msg.sender, noteHash);
        }
    }

    /// @notice Homeowner reports defects inside the review window; the contractor fixes and
    ///         re-requests (or disputes).
    function reject(uint256 stageId, bytes32 reasonHash)
        external
        onlyHomeowner
        validStage(stageId)
    {
        Stage storage s = _stages[stageId];
        if (s.status != StageStatus.Requested) revert WrongStatus(s.status);
        if (block.timestamp >= uint256(s.requestedAt) + terms.reviewWindow) {
            revert ReviewWindowOver();
        }
        s.status = StageStatus.Rejected;
        emit StageRejected(stageId, msg.sender, reasonHash);
    }

    /// @notice After a stage's deadline, the homeowner can cancel a stage the contractor has
    ///         not delivered. Its budget becomes free (withdrawable or usable for repayment).
    function cancelStage(uint256 stageId) external onlyHomeowner validStage(stageId) {
        Stage storage s = _stages[stageId];
        if (s.status != StageStatus.Pending && s.status != StageStatus.Rejected) {
            revert WrongStatus(s.status);
        }
        if (block.timestamp <= s.deadline) revert DeadlineNotPassed();
        s.status = StageStatus.Cancelled;
        committed -= s.amount;
        emit StageCancelled(stageId, s.amount);
        _maybeComplete();
    }

    // ------------------------------------------------------------------ disputes

    /// @notice Either party freezes a requested or rejected stage for the arbiter.
    function dispute(uint256 stageId, bytes32 reasonHash) external validStage(stageId) {
        if (msg.sender != roles.homeowner && msg.sender != roles.contractor) revert NotParty();
        Stage storage s = _stages[stageId];
        if (s.status != StageStatus.Requested && s.status != StageStatus.Rejected) {
            revert WrongStatus(s.status);
        }
        // Silence is acceptance: once the review window is over the homeowner can no longer
        // freeze a requested stage (she could have rejected or disputed in time).
        if (
            msg.sender == roles.homeowner && s.status == StageStatus.Requested
                && block.timestamp >= uint256(s.requestedAt) + terms.reviewWindow
        ) revert ReviewWindowOver();
        s.status = StageStatus.Disputed;
        emit StageDisputed(stageId, msg.sender, reasonHash);
    }

    /// @notice Arbiter decides how much of a disputed stage the contractor receives (in MUSD,
    ///         retention applied). The rest of the stage budget returns to the free balance.
    function resolveDispute(uint256 stageId, uint256 toContractor)
        external
        nonReentrant
        onlyArbiter
        validStage(stageId)
    {
        Stage storage s = _stages[stageId];
        if (s.status != StageStatus.Disputed) revert WrongStatus(s.status);
        uint256 gross = s.amount;
        if (toContractor > gross) revert AmountTooLarge();
        uint256 available = _spendable();
        if (available < toContractor) revert InsufficientFunds(toContractor, available);

        uint256 retention = (toContractor * terms.retentionBps) / BPS;
        uint256 net = toContractor - retention;

        s.status = toContractor == 0 ? StageStatus.Cancelled : StageStatus.Paid;
        // net <= gross, and gross was stored as uint128
        // forge-lint: disable-next-line(unsafe-typecast)
        s.paidToContractor = uint128(net);
        committed -= gross;
        retentionHeld += retention;
        principal -= net;
        totalPaidToContractor += net;
        emit DisputeResolved(stageId, toContractor, gross - toContractor);
        _maybeComplete();

        if (net > 0) {
            _withdrawFromVault(net);
            IERC20(protocol.musd).safeTransfer(roles.contractor, net);
            emit StagePaid(stageId, net, retention, PayoutAsset.MUSD, net);
        }
    }

    // ------------------------------------------------------------------ retention

    /// @notice Homeowner flags warranty defects before the retention is released.
    function disputeRetention(bytes32 reasonHash) external onlyHomeowner {
        if (completedAt == 0) revert NotCompleted();
        if (block.timestamp >= uint256(completedAt) + terms.warrantyPeriod) revert RetentionLocked();
        if (retentionHeld == 0) revert NothingToRelease();
        retentionDisputed = true;
        emit RetentionDisputed(reasonHash);
    }

    /// @notice Release the retention to the contractor: by the homeowner at any time after
    ///         completion, or by the contractor once the warranty period has passed undisputed.
    function releaseRetention() external nonReentrant {
        if (completedAt == 0) revert NotCompleted();
        uint256 amount = retentionHeld;
        if (amount == 0) revert NothingToRelease();
        if (msg.sender == roles.contractor) {
            if (retentionDisputed) revert RetentionIsDisputed();
            if (block.timestamp < uint256(completedAt) + terms.warrantyPeriod) {
                revert RetentionLocked();
            }
        } else if (msg.sender != roles.homeowner) {
            revert NotParty();
        }
        _releaseRetention(amount);
    }

    /// @notice Arbiter splits a disputed retention; the remainder becomes free for the homeowner.
    function resolveRetention(uint256 toContractor) external nonReentrant onlyArbiter {
        if (!retentionDisputed) revert RetentionNotDisputed();
        if (toContractor > retentionHeld) revert AmountTooLarge();
        retentionDisputed = false;
        _releaseRetention(toContractor);
    }

    // ------------------------------------------------------------------ homeowner money

    /// @notice Money that is not needed for any open stage or retention.
    function freeBalance() public view returns (uint256) {
        uint256 locked = committed + retentionHeld;
        return principal > locked ? principal - locked : 0;
    }

    /// @notice Missing MUSD to cover all open stages and retention.
    function shortfall() public view returns (uint256) {
        uint256 locked = committed + retentionHeld;
        return locked > principal ? locked - principal : 0;
    }

    /// @notice Homeowner withdraws surplus (over-funding, cancelled stages, dispute remainders).
    function withdrawFree(uint256 amount, address to) external nonReentrant onlyHomeowner {
        if (amount == 0) revert ZeroAmount();
        uint256 free = freeBalance();
        if (amount > free) revert InsufficientFunds(amount, free);
        principal -= amount;
        _withdrawFromVault(amount);
        IERC20(protocol.musd).safeTransfer(to, amount);
        emit FreeWithdrawn(to, amount);
    }

    /// @notice Use surplus to pay down the homeowner's trove debt. Authorised by an EIP-712
    ///         `RepayMUSD` signature; the escrow is the payer, so the MUSD is burned from here.
    function repayTroveFromFree(
        uint256 amount,
        address upperHint,
        address lowerHint,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant onlyHomeowner {
        if (amount == 0) revert ZeroAmount();
        uint256 free = freeBalance();
        if (amount > free) revert InsufficientFunds(amount, free);
        principal -= amount;
        _withdrawFromVault(amount);

        IERC20 musd = IERC20(protocol.musd);
        uint256 balBefore = musd.balanceOf(address(this));
        IBorrowerOperationsSignatures(protocol.borrowerOpsSignatures).repayMUSDWithSignature(
            amount, upperHint, lowerHint, roles.homeowner, signature, deadline
        );
        uint256 burned = balBefore - musd.balanceOf(address(this));
        if (burned != amount) revert RepayMismatch(burned, amount);
        totalRepaidToTrove += amount;
        emit TroveRepaid(amount);
    }

    // ------------------------------------------------------------------ yield

    /// @notice Pull accrued Savings Rate yield and send it to the homeowner. Permissionless.
    ///         It first pokes the (permissionless) PCV distribution so freshly accrued protocol
    ///         fees reach the vault.
    function harvest() external nonReentrant returns (uint256 amount) {
        address pcv = protocol.pcv;
        if (pcv != address(0)) {
            try IPCV(pcv).distributeMUSD() {} catch {}
        }
        IERC20 musd = IERC20(protocol.musd);
        uint256 balBefore = musd.balanceOf(address(this));
        IMUSDSavingsRate(protocol.savingsVault).claimYield();
        amount = musd.balanceOf(address(this)) - balBefore;
        if (amount > 0) _payYield(amount);
    }

    /// @notice Yield earned by this escrow in the vault that has not been paid out yet.
    function pendingYield() external view returns (uint256) {
        IMUSDSavingsRate v = IMUSDSavingsRate(protocol.savingsVault);
        uint256 bal = v.balanceOf(address(this));
        uint256 accrued = (bal * (v.yieldIndex() - v.supplyYieldIndex(address(this)))) / 1e18;
        return v.claimableYield(address(this)) + accrued;
    }

    // ------------------------------------------------------------------ views

    function stageCount() external view returns (uint256) {
        return _stages.length;
    }

    function getStage(uint256 stageId) external view validStage(stageId) returns (Stage memory) {
        return _stages[stageId];
    }

    function getStages() external view returns (Stage[] memory) {
        return _stages;
    }

    function isClaimable(uint256 stageId) external view validStage(stageId) returns (bool) {
        return _isClaimable(_stages[stageId]);
    }

    /// @notice Current collateral ratio of the homeowner's trove (1e18 = 100 %), 0 if none.
    function homeownerICR() public view returns (uint256) {
        ITroveManager tm = ITroveManager(protocol.troveManager);
        if (tm.getTroveStatus(roles.homeowner) != 1) return 0;
        uint256 price = IPriceFeed(protocol.priceFeed).fetchPrice();
        return tm.getCurrentICR(roles.homeowner, price);
    }

    // ------------------------------------------------------------------ internal

    /// @dev Principal that may pay stages. Retention already withheld is ring-fenced for the
    ///      warranty period and can never be used to pay a later stage.
    function _spendable() internal view returns (uint256) {
        return principal - retentionHeld;
    }

    function _isClaimable(Stage storage s) internal view returns (bool) {
        if (s.status == StageStatus.Approved) return true;
        if (s.status != StageStatus.Requested) return false;
        bool reviewOver = block.timestamp >= uint256(s.requestedAt) + terms.reviewWindow;
        bool inspectionOk = roles.inspector == address(0) || s.inspectorApproved;
        return reviewOver && inspectionOk;
    }

    function _maybeReady(uint256 stageId, Stage storage s) internal {
        bool inspectionOk = roles.inspector == address(0) || s.inspectorApproved;
        if (s.homeownerApproved && inspectionOk) {
            s.status = StageStatus.Approved;
            emit StageReady(stageId);
        }
    }

    function _maybeComplete() internal {
        if (committed == 0 && completedAt == 0) {
            completedAt = uint64(block.timestamp);
            emit ProjectCompleted(completedAt);
        }
    }

    function _releaseRetention(uint256 toContractor) internal {
        uint256 held = retentionHeld;
        uint256 toHomeowner = held - toContractor;
        retentionHeld = 0;
        if (toContractor > 0) {
            principal -= toContractor;
            totalPaidToContractor += toContractor;
            _withdrawFromVault(toContractor);
            IERC20(protocol.musd).safeTransfer(roles.contractor, toContractor);
        }
        // the homeowner's share stays in the vault and simply becomes free balance
        emit RetentionReleased(toContractor, toHomeowner);
    }

    function _depositToVault(uint256 amount) internal {
        IERC20(protocol.musd).forceApprove(protocol.savingsVault, amount);
        IMUSDSavingsRate(protocol.savingsVault).deposit(amount);
        principal += amount;
    }

    /// @dev The vault pays accrued yield together with every withdrawal; that extra MUSD is
    ///      forwarded to the homeowner so it can never be mistaken for principal.
    function _withdrawFromVault(uint256 amount) internal {
        IERC20 musd = IERC20(protocol.musd);
        uint256 balBefore = musd.balanceOf(address(this));
        IMUSDSavingsRate(protocol.savingsVault).withdraw(amount);
        uint256 received = musd.balanceOf(address(this)) - balBefore;
        if (received > amount) _payYield(received - amount);
    }

    function _payYield(uint256 amount) internal {
        totalYieldPaid += amount;
        IERC20(protocol.musd).safeTransfer(roles.homeowner, amount);
        emit YieldPaid(roles.homeowner, amount);
    }

    function _payContractor(uint256 net, PayoutAsset asset, uint256 minOut)
        internal
        returns (uint256 out)
    {
        if (asset == PayoutAsset.MUSD) {
            IERC20(protocol.musd).safeTransfer(roles.contractor, net);
            return net;
        }
        IMezoRouter.Route[] memory routes = new IMezoRouter.Route[](1);
        routes[0] = IMezoRouter.Route({
            from: protocol.musd,
            to: protocol.btc,
            stable: false,
            factory: protocol.poolFactory
        });
        IERC20(protocol.musd).forceApprove(protocol.router, net);
        uint256[] memory amounts = IMezoRouter(protocol.router).swapExactTokensForTokens(
            net, minOut, routes, roles.contractor, block.timestamp
        );
        out = amounts[amounts.length - 1];
    }
}
