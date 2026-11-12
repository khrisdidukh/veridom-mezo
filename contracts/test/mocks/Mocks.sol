// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IMezoRouter} from "../../src/interfaces/IMezo.sol";

/// @dev MUSD stand-in: 18 decimals, EIP-2612 permit, privileged mint/burn like the real token.
contract MockMUSD is ERC20Permit {
    mapping(address => bool) public minters;

    constructor() ERC20("Mezo USD", "MUSD") ERC20Permit("Mezo USD") {}

    function setMinter(address who, bool ok) external {
        minters[who] = ok;
    }

    function mint(address to, uint256 amount) external {
        // open mint for tests (the real MUSD restricts this to the protocol)
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(minters[msg.sender], "not burner");
        _burn(from, amount);
    }
}

contract MockBTC is ERC20 {
    constructor() ERC20("Bitcoin", "BTC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Faithful re-implementation of the yield-index accounting of Mezo's MUSDSavingsRate
///      (verified source on Mezo testnet), minus upgradeability, strategy and gauge.
contract MockSavingsRate is ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable musdToken;
    uint256 public yieldIndex;
    uint256 public pendingYield;
    mapping(address => uint256) public supplyYieldIndex;
    mapping(address => uint256) public claimableYield;

    constructor(address musd) ERC20("MUSD Savings Rate", "sMUSD") {
        musdToken = IERC20(musd);
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "zero");
        musdToken.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "zero");
        require(balanceOf(msg.sender) >= amount, "balance");
        _claimYield(msg.sender);
        _burn(msg.sender, amount);
        musdToken.safeTransfer(msg.sender, amount);
    }

    function claimYield() external returns (uint256) {
        return _claimYield(msg.sender);
    }

    function receiveProtocolYield(uint256 amount) external {
        require(amount > 0, "zero");
        musdToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 ts = totalSupply();
        if (ts > 0) {
            uint256 total = amount + pendingYield;
            pendingYield = 0;
            uint256 ratio = (total * 1e18) / ts;
            require(ratio > 0, "AmountTooSmall");
            yieldIndex += ratio;
        } else {
            pendingYield += amount;
        }
    }

    function _claimYield(address who) internal returns (uint256 c) {
        _updateYieldFor(who);
        c = claimableYield[who];
        if (c > 0) {
            claimableYield[who] = 0;
            musdToken.safeTransfer(who, c);
        }
    }

    function _updateYieldFor(address who) internal {
        uint256 bal = balanceOf(who);
        if (bal > 0) {
            uint256 delta = yieldIndex - supplyYieldIndex[who];
            supplyYieldIndex[who] = yieldIndex;
            if (delta > 0) claimableYield[who] += (bal * delta) / 1e18;
        } else {
            supplyYieldIndex[who] = yieldIndex;
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != to) {
            if (from != address(0)) _updateYieldFor(from);
            if (to != address(0)) _updateYieldFor(to);
        }
        super._update(from, to, value);
    }
}

/// @dev PCV stand-in: holds accrued fees and pushes 50 % of them into the savings vault.
contract MockPCV {
    IERC20 public immutable musd;
    MockSavingsRate public immutable vault;

    constructor(address musd_, address vault_) {
        musd = IERC20(musd_);
        vault = MockSavingsRate(vault_);
    }

    function distributeMUSD() external {
        uint256 bal = musd.balanceOf(address(this));
        if (bal == 0) return;
        uint256 toVault = bal / 2;
        musd.approve(address(vault), toVault);
        vault.receiveProtocolYield(toVault);
    }
}

/// @dev Trove manager + price feed stand-in with simple per-borrower state.
contract MockTroveManager {
    struct T {
        uint8 status;
        uint256 coll;
        uint256 debt;
    }

    mapping(address => T) public troves;
    uint256 public price = 70_000e18;

    function setPrice(uint256 p) external {
        price = p;
    }

    function fetchPrice() external view returns (uint256) {
        return price;
    }

    function setTrove(address b, uint256 coll, uint256 debt) external {
        troves[b] = T(1, coll, debt);
    }

    function addDebt(address b, uint256 amount) external {
        troves[b].debt += amount;
    }

    function subDebt(address b, uint256 amount) external {
        troves[b].debt -= amount;
    }

    function getTroveStatus(address b) external view returns (uint8) {
        return troves[b].status;
    }

    function getCurrentICR(address b, uint256 p) external view returns (uint256) {
        T memory t = troves[b];
        if (t.debt == 0) return type(uint256).max;
        return (t.coll * p) / t.debt;
    }

    function getEntireDebtAndColl(address b)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        T memory t = troves[b];
        return (t.coll, t.debt, 0, 0, 0, 0);
    }

    function getTroveInterestRate(address) external pure returns (uint16) {
        return 100;
    }

    function getTCR(uint256) external pure returns (uint256) {
        return 2.5e18;
    }

    function checkRecoveryMode(uint256) external pure returns (bool) {
        return false;
    }

    function MUSD_GAS_COMPENSATION() external pure returns (uint256) {
        return 200e18;
    }

    function getBorrowingFee(uint256 d) external pure returns (uint256) {
        return d / 1000;
    }
}

/// @dev EIP-712 signature entry point with the same domain name, version and type strings as
///      Mezo's BorrowerOperationsSignatures.
contract MockBorrowerOpsSignatures is EIP712 {
    bytes32 private constant WITHDRAW_MUSD_TYPEHASH = keccak256(
        "WithdrawMUSD(uint256 amount,address borrower,address recipient,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant REPAY_MUSD_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");

    MockMUSD public immutable musd;
    MockTroveManager public immutable tm;
    mapping(address => uint256) public nonces;

    constructor(address musd_, address tm_) EIP712("BorrowerOperationsSignatures", "1") {
        musd = MockMUSD(musd_);
        tm = MockTroveManager(tm_);
    }

    function getNonce(address u) external view returns (uint256) {
        return nonces[u];
    }

    function digestWithdraw(uint256 amount, address borrower, address recipient, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(
                abi.encodePacked(
                    WITHDRAW_MUSD_TYPEHASH,
                    abi.encode(amount, borrower, recipient),
                    nonces[borrower],
                    deadline
                )
            )
        );
    }

    function digestRepay(uint256 amount, address borrower, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(
                abi.encodePacked(
                    REPAY_MUSD_TYPEHASH, abi.encode(amount, borrower), nonces[borrower], deadline
                )
            )
        );
    }

    function _verify(bytes32 digest, address borrower, bytes memory sig, uint256 deadline)
        internal
    {
        require(block.timestamp <= deadline, "Signature expired");
        require(ECDSA.recover(digest, sig) == borrower, "Invalid signature");
        nonces[borrower]++;
    }

    function withdrawMUSDWithSignature(
        uint256 amount,
        address,
        address,
        address borrower,
        address recipient,
        bytes memory signature,
        uint256 deadline
    ) external {
        _verify(this.digestWithdraw(amount, borrower, recipient, deadline), borrower, signature, deadline);
        tm.addDebt(borrower, amount + amount / 1000);
        musd.mint(recipient, amount);
    }

    function repayMUSDWithSignature(
        uint256 amount,
        address,
        address,
        address borrower,
        bytes memory signature,
        uint256 deadline
    ) external {
        _verify(this.digestRepay(amount, borrower, deadline), borrower, signature, deadline);
        tm.subDebt(borrower, amount);
        musd.burn(msg.sender, amount);
    }
}

/// @dev Router stand-in: swaps MUSD for BTC at the trove manager's oracle price minus 1 %.
contract MockRouter {
    MockTroveManager public immutable tm;
    MockBTC public immutable btc;

    constructor(address tm_, address btc_) {
        tm = MockTroveManager(tm_);
        btc = MockBTC(btc_);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        IMezoRouter.Route[] calldata routes,
        address to,
        uint256
    ) external virtual returns (uint256[] memory amounts) {
        IERC20(routes[0].from).transferFrom(msg.sender, address(this), amountIn);
        uint256 out = (amountIn * 1e18 / tm.price()) * 99 / 100;
        require(out >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        btc.mint(to, out);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }
}

interface IEscrowLike {
    function claim(uint256 stageId, uint8 asset, uint256 minOut) external;
    function withdrawFree(uint256 amount, address to) external;
}

/// @dev Malicious router that tries to re-enter the escrow during a BTC payout.
contract ReentrantRouter is MockRouter {
    address public target;
    bytes public lastRevert;

    constructor(address tm_, address btc_) MockRouter(tm_, btc_) {}

    function setTarget(address t) external {
        target = t;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        IMezoRouter.Route[] calldata routes,
        address to,
        uint256 d
    ) external override returns (uint256[] memory amounts) {
        // attempt to claim the same stage again while the first claim is in flight
        (bool ok, bytes memory ret) =
            target.call(abi.encodeWithSelector(IEscrowLike.claim.selector, 0, uint8(0), 0));
        require(!ok, "reentrancy succeeded");
        lastRevert = ret;
        amounts = new uint256[](2);
        IERC20(routes[0].from).transferFrom(msg.sender, address(this), amountIn);
        amounts[0] = amountIn;
        amounts[1] = amountOutMin;
        btc.mint(to, amountOutMin);
        d;
    }
}
