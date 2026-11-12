// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "./BaseTest.sol";
import {BuildFundEscrow} from "../src/BuildFundEscrow.sol";
import {BuildFundFactory} from "../src/BuildFundFactory.sol";
import {ReentrantRouter, MockMUSD, MockSavingsRate} from "./mocks/Mocks.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

contract BuildFundEscrowTest is BaseTest {
    BuildFundEscrow e;

    function setUp() public override {
        super.setUp();
        e = _create(true);
    }

    // ------------------------------------------------------------- creation

    function test_create_setsStateAndRegistry() public view {
        assertEq(e.stageCount(), 6);
        assertEq(e.committed(), BUDGET);
        assertEq(e.principal(), 0);
        assertEq(e.shortfall(), BUDGET);
        (address h, address c, address i, address a) = e.roles();
        assertEq(h, homeowner);
        assertEq(c, contractor);
        assertEq(i, inspector);
        assertEq(a, arbiter);
        assertTrue(factory.isProject(address(e)));
        assertEq(factory.projectsOf(homeowner)[0], address(e));
        assertEq(factory.projectsOf(contractor)[0], address(e));
        assertEq(factory.projectsOf(inspector)[0], address(e));
        assertEq(factory.projectCount(), 1);
        BuildFundEscrow.Stage memory s = e.getStage(1);
        assertEq(s.name, "Shell & roof");
        assertEq(s.amount, 3_000e18);
        assertEq(uint8(s.status), uint8(BuildFundEscrow.StageStatus.Pending));
    }

    function test_create_onlyHomeowner() public {
        vm.prank(contractor);
        vm.expectRevert(BuildFundFactory.NotHomeowner.selector);
        factory.createProject(_roles(true), _terms(), _stages());
    }

    function test_create_rejectsBadRoles() public {
        BuildFundEscrow.Roles memory r = _roles(true);
        r.contractor = homeowner;
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidRoles.selector);
        factory.createProject(r, _terms(), _stages());

        r = _roles(true);
        r.arbiter = address(0);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidRoles.selector);
        factory.createProject(r, _terms(), _stages());

        r = _roles(true);
        r.inspector = contractor;
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidRoles.selector);
        factory.createProject(r, _terms(), _stages());
    }

    function test_create_rejectsBadTerms() public {
        BuildFundEscrow.Terms memory t = _terms();
        t.retentionBps = 1_001;
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidTerms.selector);
        factory.createProject(_roles(true), t, _stages());

        t = _terms();
        t.reviewWindow = 0;
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidTerms.selector);
        factory.createProject(_roles(true), t, _stages());

        t = _terms();
        t.minIcrAfterDraw = 1.05e18; // below the 110 % MCR makes no sense
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidTerms.selector);
        factory.createProject(_roles(true), t, _stages());
    }

    function test_create_rejectsBadStages() public {
        BuildFundEscrow.StageInput[] memory s = _stages();
        s[2].amount = 0;
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidStages.selector);
        factory.createProject(_roles(true), _terms(), s);

        s = _stages();
        s[3].deadline = s[2].deadline - 1; // deadlines must not go backwards
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidStages.selector);
        factory.createProject(_roles(true), _terms(), s);

        s = new BuildFundEscrow.StageInput[](0);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidStages.selector);
        factory.createProject(_roles(true), _terms(), s);
    }

    function test_cloneAndImplementationCannotBeReinitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        e.initialize(_protocol(address(router)), _roles(true), _terms(), _stages());
        BuildFundEscrow impl = BuildFundEscrow(payable(factory.implementation()));
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(_protocol(address(router)), _roles(true), _terms(), _stages());
    }

    function test_factory_rejectsVaultForOtherToken() public {
        BuildFundEscrow.Protocol memory p = _protocol(address(router));
        p.savingsVault = address(new MockSavingsRate(address(new MockMUSD())));
        vm.expectRevert(BuildFundFactory.VaultMismatch.selector);
        new BuildFundFactory(p);
    }

    // ------------------------------------------------------------- funding

    function test_fund_parksMoneyInSavingsVault() public {
        _fund(e, BUDGET);
        assertEq(e.principal(), BUDGET);
        assertEq(vault.balanceOf(address(e)), BUDGET);
        assertEq(e.totalFunded(), BUDGET);
        assertEq(e.shortfall(), 0);
        assertEq(e.freeBalance(), 0);
        _assertAccounting(e);
    }

    function test_fund_anyoneCanFund() public {
        musd.mint(stranger, 500e18);
        vm.startPrank(stranger);
        musd.approve(address(e), 500e18);
        e.fund(500e18);
        vm.stopPrank();
        assertEq(e.principal(), 500e18);
    }

    function test_fund_zeroReverts() public {
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.ZeroAmount.selector);
        e.fund(0);
    }

    function test_fundWithPermit() public {
        musd.mint(homeowner, 1_000e18);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                homeowner,
                address(e),
                1_000e18,
                musd.nonces(homeowner),
                deadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(homeownerPk, digest);
        vm.prank(homeowner);
        e.fundWithPermit(1_000e18, deadline, v, r, s);
        assertEq(e.principal(), 1_000e18);
        _assertAccounting(e);
    }

    // ------------------------------------------------------------- happy path

    function test_happyPath_fullBuildWithRetention() public {
        _fund(e, BUDGET);
        for (uint256 i; i < 6; ++i) {
            _ready(e, i);
            assertTrue(e.isClaimable(i));
            _claim(e, i);
            _assertAccounting(e);
        }
        uint256 expectedNet = BUDGET * 98 / 100;
        assertEq(musd.balanceOf(contractor), expectedNet);
        assertEq(e.retentionHeld(), BUDGET - expectedNet);
        assertEq(e.committed(), 0);
        assertGt(e.completedAt(), 0);

        // contractor must wait for the warranty period
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.RetentionLocked.selector);
        e.releaseRetention();

        vm.warp(block.timestamp + WARRANTY);
        vm.prank(contractor);
        e.releaseRetention();
        assertEq(musd.balanceOf(contractor), BUDGET);
        assertEq(e.principal(), 0);
        assertEq(e.totalPaidToContractor(), BUDGET);
        _assertAccounting(e);
    }

    function test_withoutInspector_homeownerApprovalIsEnough() public {
        BuildFundEscrow e2 = _create(false);
        _fund(e2, BUDGET);
        vm.prank(contractor);
        e2.acceptProject();
        vm.prank(contractor);
        e2.requestRelease(0, bytes32("photos"));
        assertFalse(e2.isClaimable(0));
        vm.prank(homeowner);
        e2.approve(0);
        assertTrue(e2.isClaimable(0));
        _claim(e2, 0);
        assertEq(musd.balanceOf(contractor), 980e18);
    }

    function test_needsBothSignoffs_whenInspectorConfigured() public {
        _fund(e, BUDGET);
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(0, bytes32("photos"));
        vm.prank(homeowner);
        e.approve(0);
        assertFalse(e.isClaimable(0));
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.NotYetClaimable.selector);
        e.claim(0, BuildFundEscrow.PayoutAsset.MUSD, 0);
        vm.prank(inspector);
        e.inspect(0, true, bytes32("site visit ok"));
        assertTrue(e.isClaimable(0));
    }

    function test_requestNeedsAcceptedTerms() public {
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.NotAccepted.selector);
        e.requestRelease(0, bytes32("x"));
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.AlreadyAccepted.selector);
        e.acceptProject();
    }

    // ------------------------------------------------------------- review window

    function test_silenceIsAcceptance_afterReviewWindow() public {
        _fund(e, BUDGET);
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(1, bytes32("shell done"));
        vm.prank(inspector);
        e.inspect(1, true, bytes32("ok"));
        assertFalse(e.isClaimable(1));
        vm.warp(block.timestamp + REVIEW - 1);
        assertFalse(e.isClaimable(1));
        vm.warp(block.timestamp + 1);
        assertTrue(e.isClaimable(1));
        _claim(e, 1);
        assertEq(musd.balanceOf(contractor), 2_940e18);
    }

    function test_silenceIsAcceptance_stillNeedsInspector() public {
        _fund(e, BUDGET);
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(1, bytes32("shell done"));
        vm.warp(block.timestamp + REVIEW + 1);
        assertFalse(e.isClaimable(1));
    }

    function test_reject_withinWindow_thenFixAndRerequest() public {
        _fund(e, BUDGET);
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(2, bytes32("rough-in"));
        vm.prank(inspector);
        e.inspect(2, true, bytes32("ok"));
        vm.prank(homeowner);
        e.reject(2, bytes32("missing sockets in kitchen"));
        assertEq(uint8(e.getStage(2).status), uint8(BuildFundEscrow.StageStatus.Rejected));

        // re-request resets all sign-offs
        vm.prank(contractor);
        e.requestRelease(2, bytes32("rough-in v2"));
        BuildFundEscrow.Stage memory s = e.getStage(2);
        assertFalse(s.inspectorApproved);
        assertEq(s.evidenceHash, bytes32("rough-in v2"));
        vm.prank(homeowner);
        e.approve(2);
        vm.prank(inspector);
        e.inspect(2, true, bytes32("ok"));
        _claim(e, 2);
        assertEq(musd.balanceOf(contractor), 1_960e18);
    }

    function test_reject_afterWindowReverts() public {
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(0, bytes32("x"));
        vm.warp(block.timestamp + REVIEW);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.ReviewWindowOver.selector);
        e.reject(0, bytes32("late"));
    }

    function test_inspectorFail_rejectsStage() public {
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(0, bytes32("x"));
        vm.prank(inspector);
        e.inspect(0, false, bytes32("rebar spacing wrong"));
        assertEq(uint8(e.getStage(0).status), uint8(BuildFundEscrow.StageStatus.Rejected));
        assertFalse(e.isClaimable(0));
    }

    // ------------------------------------------------------------- disputes

    function test_dispute_partialResolution() public {
        _fund(e, BUDGET);
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(1, bytes32("shell"));
        vm.prank(homeowner);
        e.dispute(1, bytes32("roof not watertight"));
        assertEq(uint8(e.getStage(1).status), uint8(BuildFundEscrow.StageStatus.Disputed));

        // frozen: no claim, no approval
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.NotYetClaimable.selector);
        e.claim(1, BuildFundEscrow.PayoutAsset.MUSD, 0);

        vm.prank(arbiter);
        e.resolveDispute(1, 2_000e18);
        assertEq(musd.balanceOf(contractor), 1_960e18); // 2 % retention on the awarded part
        assertEq(e.retentionHeld(), 40e18);
        assertEq(e.freeBalance(), 1_000e18);
        _assertAccounting(e);

        uint256 before = musd.balanceOf(homeowner);
        vm.prank(homeowner);
        e.withdrawFree(1_000e18, homeowner);
        assertEq(musd.balanceOf(homeowner) - before, 1_000e18);
        _assertAccounting(e);
    }

    function test_dispute_resolvedToZeroCancelsStage() public {
        _fund(e, BUDGET);
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(0, bytes32("x"));
        vm.prank(contractor);
        e.dispute(0, bytes32("homeowner unresponsive"));
        vm.prank(arbiter);
        e.resolveDispute(0, 0);
        assertEq(uint8(e.getStage(0).status), uint8(BuildFundEscrow.StageStatus.Cancelled));
        assertEq(e.freeBalance(), 1_000e18);
    }

    function test_dispute_homeownerTooLate_contractorAnytime() public {
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(0, bytes32("x"));
        vm.warp(block.timestamp + REVIEW);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.ReviewWindowOver.selector);
        e.dispute(0, bytes32("late"));
        vm.prank(contractor);
        e.dispute(0, bytes32("inspector absent"));
    }

    function test_resolveDispute_bounds() public {
        _fund(e, BUDGET);
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(0, bytes32("x"));
        vm.prank(contractor);
        e.dispute(0, bytes32("y"));
        vm.prank(arbiter);
        vm.expectRevert(BuildFundEscrow.AmountTooLarge.selector);
        e.resolveDispute(0, 1_000e18 + 1);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.NotArbiter.selector);
        e.resolveDispute(0, 1);
    }

    // ------------------------------------------------------------- deadlines

    function test_cancelAfterDeadline_returnsMoney() public {
        _fund(e, BUDGET);
        BuildFundEscrow.Stage memory s5 = e.getStage(5);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.DeadlineNotPassed.selector);
        e.cancelStage(5);

        vm.warp(s5.deadline + 1);
        vm.prank(homeowner);
        e.cancelStage(5);
        assertEq(e.committed(), BUDGET - 900e18);
        assertEq(e.freeBalance(), 900e18);
        vm.prank(homeowner);
        e.withdrawFree(900e18, homeowner);
        assertEq(musd.balanceOf(homeowner), 900e18);
        _assertAccounting(e);
    }

    function test_cannotCancelRequestedStage() public {
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(0, bytes32("x"));
        vm.warp(e.getStage(0).deadline + 1);
        vm.prank(homeowner);
        vm.expectRevert(
            abi.encodeWithSelector(
                BuildFundEscrow.WrongStatus.selector, BuildFundEscrow.StageStatus.Requested
            )
        );
        e.cancelStage(0);
    }

    function test_cancelLastOpenStage_completesProject() public {
        _fund(e, BUDGET);
        for (uint256 i; i < 5; ++i) {
            _ready(e, i);
            _claim(e, i);
        }
        assertEq(e.completedAt(), 0);
        vm.warp(e.getStage(5).deadline + 1);
        vm.prank(homeowner);
        e.cancelStage(5);
        assertGt(e.completedAt(), 0);
    }

    // ------------------------------------------------------------- funding gaps

    function test_claim_revertsWhenUnderfunded() public {
        _fund(e, 500e18);
        _ready(e, 0);
        vm.prank(contractor);
        vm.expectRevert(
            abi.encodeWithSelector(BuildFundEscrow.InsufficientFunds.selector, 1_000e18, 500e18)
        );
        e.claim(0, BuildFundEscrow.PayoutAsset.MUSD, 0);
        _fund(e, 500e18);
        _claim(e, 0);
    }

    /// Regression for a bug found by the invariant suite: withheld retention must never pay
    /// for a later stage when the project is under-funded.
    function test_claim_cannotSpendRingFencedRetention() public {
        _fund(e, 1_000e18);
        _ready(e, 0);
        _claim(e, 0); // 980 paid, 20 retained, principal 20
        _fund(e, 2_980e18); // principal 3,000, of which 20 is retention
        _ready(e, 1);
        vm.prank(contractor);
        vm.expectRevert(
            abi.encodeWithSelector(BuildFundEscrow.InsufficientFunds.selector, 3_000e18, 2_980e18)
        );
        e.claim(1, BuildFundEscrow.PayoutAsset.MUSD, 0);
        _fund(e, 20e18);
        _claim(e, 1);
        assertEq(e.retentionHeld(), 80e18);
        assertEq(e.principal(), 80e18);
        _assertAccounting(e);
    }

    function test_withdrawFree_cannotTouchCommittedMoney() public {
        _fund(e, BUDGET + 100e18);
        assertEq(e.freeBalance(), 100e18);
        vm.prank(homeowner);
        vm.expectRevert(
            abi.encodeWithSelector(BuildFundEscrow.InsufficientFunds.selector, 101e18, 100e18)
        );
        e.withdrawFree(101e18, homeowner);
        vm.prank(homeowner);
        e.withdrawFree(100e18, homeowner);
        _assertAccounting(e);
    }

    // ------------------------------------------------------------- yield

    function test_harvest_paysSavingsYieldToHomeowner() public {
        _fund(e, BUDGET);
        // protocol fees accrue in PCV; harvest pokes the permissionless distribution
        musd.mint(address(pcv), 1_000e18);
        uint256 expected = (BUDGET * ((500e18 * 1e18) / (90_000e18 + BUDGET))) / 1e18;
        vm.prank(stranger);
        uint256 got = e.harvest();
        assertEq(got, expected);
        assertEq(musd.balanceOf(homeowner), expected);
        assertEq(e.totalYieldPaid(), expected);
        assertEq(e.principal(), BUDGET, "principal untouched");
        _assertAccounting(e);
    }

    function test_pendingYield_viewMatchesHarvest() public {
        _fund(e, BUDGET);
        musd.mint(address(this), 2_000e18);
        musd.approve(address(vault), 2_000e18);
        vault.receiveProtocolYield(2_000e18);
        uint256 pending = e.pendingYield();
        assertGt(pending, 0);
        assertEq(e.harvest(), pending);
        assertEq(e.pendingYield(), 0);
    }

    function test_yieldNeverLeaksToContractor() public {
        _fund(e, BUDGET);
        musd.mint(address(this), 5_000e18);
        musd.approve(address(vault), 5_000e18);
        vault.receiveProtocolYield(5_000e18);
        uint256 pending = e.pendingYield();
        _ready(e, 0);
        _claim(e, 0); // the vault pays accrued yield along with the withdrawal
        assertEq(musd.balanceOf(contractor), 980e18, "contractor gets exactly the stage");
        assertEq(musd.balanceOf(homeowner), pending, "yield forwarded to homeowner");
        _assertAccounting(e);
    }

    // ------------------------------------------------------------- trove integration

    function test_drawFromTrove_anyoneCanSubmitSignedDraw() public {
        tm.setTrove(homeowner, 1e18, 20_000e18); // 1 BTC @ 70k vs 20k debt = 350 %
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signWithdraw(5_000e18, address(e), deadline);
        vm.prank(stranger); // e.g. the Veridom relayer
        e.drawFromTrove(5_000e18, address(0), address(0), deadline, sig);
        assertEq(e.principal(), 5_000e18);
        assertEq(e.totalDrawnFromTrove(), 5_000e18);
        (,, uint256 debt) = tm.troves(homeowner);
        assertEq(debt, 25_005e18); // + 0.1 % borrowing fee in the mock
        _assertAccounting(e);

        // replay is impossible (nonce consumed)
        vm.expectRevert("Invalid signature");
        e.drawFromTrove(5_000e18, address(0), address(0), deadline, sig);
    }

    function test_drawFromTrove_guardBlocksRiskyDraw() public {
        tm.setTrove(homeowner, 1e18, 40_000e18); // 175 %
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signWithdraw(5_000e18, address(e), deadline);
        vm.expectPartialRevert(BuildFundEscrow.DrawGuard.selector); // ICR after draw ~155 % < 160 %
        e.drawFromTrove(5_000e18, address(0), address(0), deadline, sig);

        // homeowner can consciously relax the guard
        vm.prank(homeowner);
        e.setDrawGuard(1.5e18);
        e.drawFromTrove(5_000e18, address(0), address(0), deadline, sig);
        assertGt(e.homeownerICR(), 1.5e18);
    }

    function test_drawFromTrove_signatureForOtherRecipientFails() public {
        tm.setTrove(homeowner, 1e18, 10_000e18);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signWithdraw(1_000e18, stranger, deadline);
        vm.expectRevert("Invalid signature");
        e.drawFromTrove(1_000e18, address(0), address(0), deadline, sig);
    }

    function test_setDrawGuard_onlyHomeownerAndSane() public {
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.NotHomeowner.selector);
        e.setDrawGuard(0);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.InvalidTerms.selector);
        e.setDrawGuard(1e18);
        vm.prank(homeowner);
        e.setDrawGuard(0);
    }

    function test_repayTroveFromFree_afterCancelledStage() public {
        tm.setTrove(homeowner, 1e18, 20_000e18);
        _fund(e, BUDGET);
        vm.warp(e.getStage(5).deadline + 1);
        vm.prank(homeowner);
        e.cancelStage(5);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signRepay(900e18, deadline);
        vm.prank(homeowner);
        e.repayTroveFromFree(900e18, address(0), address(0), deadline, sig);
        (,, uint256 debt) = tm.troves(homeowner);
        assertEq(debt, 19_100e18);
        assertEq(e.totalRepaidToTrove(), 900e18);
        _assertAccounting(e);
    }

    function test_repayTroveFromFree_cannotUseCommittedMoney() public {
        tm.setTrove(homeowner, 1e18, 20_000e18);
        _fund(e, BUDGET);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signRepay(100e18, deadline);
        vm.prank(homeowner);
        vm.expectRevert(abi.encodeWithSelector(BuildFundEscrow.InsufficientFunds.selector, 100e18, 0));
        e.repayTroveFromFree(100e18, address(0), address(0), deadline, sig);
    }

    // ------------------------------------------------------------- BTC payout via DEX

    function test_claimInBtc_viaMezoPool() public {
        _fund(e, BUDGET);
        _ready(e, 1);
        uint256 quote = (2_940e18 * 1e18 / 70_000e18) * 99 / 100;
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.MinOutRequired.selector);
        e.claim(1, BuildFundEscrow.PayoutAsset.BTC, 0);
        vm.prank(contractor);
        vm.expectRevert("INSUFFICIENT_OUTPUT_AMOUNT");
        e.claim(1, BuildFundEscrow.PayoutAsset.BTC, quote + 1);
        vm.prank(contractor);
        e.claim(1, BuildFundEscrow.PayoutAsset.BTC, quote);
        assertEq(btc.balanceOf(contractor), quote);
        assertEq(musd.balanceOf(contractor), 0);
        _assertAccounting(e);
    }

    // ------------------------------------------------------------- security

    function test_reentrancy_viaRouterIsBlocked() public {
        ReentrantRouter evil = new ReentrantRouter(address(tm), address(btc));
        BuildFundFactory f2 = new BuildFundFactory(_protocol(address(evil)));
        vm.prank(homeowner);
        BuildFundEscrow e2 = BuildFundEscrow(payable(f2.createProject(_roles(true), _terms(), _stages())));
        evil.setTarget(address(e2));
        _fund(e2, BUDGET);
        _ready(e2, 0);
        vm.prank(contractor);
        e2.claim(0, BuildFundEscrow.PayoutAsset.BTC, 1);
        assertEq(
            bytes4(evil.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        assertEq(uint8(e2.getStage(0).status), uint8(BuildFundEscrow.StageStatus.Paid));
    }

    function test_accessControl_everyRestrictedEntryPoint() public {
        _fund(e, BUDGET);
        vm.startPrank(stranger);
        vm.expectRevert(BuildFundEscrow.NotContractor.selector);
        e.acceptProject();
        vm.expectRevert(BuildFundEscrow.NotContractor.selector);
        e.requestRelease(0, bytes32(0));
        vm.expectRevert(BuildFundEscrow.NotContractor.selector);
        e.claim(0, BuildFundEscrow.PayoutAsset.MUSD, 0);
        vm.expectRevert(BuildFundEscrow.NotHomeowner.selector);
        e.approve(0);
        vm.expectRevert(BuildFundEscrow.NotHomeowner.selector);
        e.reject(0, bytes32(0));
        vm.expectRevert(BuildFundEscrow.NotHomeowner.selector);
        e.cancelStage(0);
        vm.expectRevert(BuildFundEscrow.NotHomeowner.selector);
        e.withdrawFree(1, stranger);
        vm.expectRevert(BuildFundEscrow.NotHomeowner.selector);
        e.repayTroveFromFree(1, address(0), address(0), 0, "");
        vm.expectRevert(BuildFundEscrow.NotHomeowner.selector);
        e.disputeRetention(bytes32(0));
        vm.expectRevert(BuildFundEscrow.NotInspector.selector);
        e.inspect(0, true, bytes32(0));
        vm.expectRevert(BuildFundEscrow.NotParty.selector);
        e.dispute(0, bytes32(0));
        vm.expectRevert(BuildFundEscrow.NotArbiter.selector);
        e.resolveDispute(0, 0);
        vm.expectRevert(BuildFundEscrow.NotArbiter.selector);
        e.resolveRetention(0);
        vm.stopPrank();

        // the contractor cannot approve its own work, the homeowner cannot inspect
        vm.prank(contractor);
        e.acceptProject();
        vm.prank(contractor);
        e.requestRelease(0, bytes32("x"));
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.NotHomeowner.selector);
        e.approve(0);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.NotInspector.selector);
        e.inspect(0, true, bytes32(0));
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.NotContractor.selector);
        e.claim(0, BuildFundEscrow.PayoutAsset.MUSD, 0);
    }

    function test_cannotPayStageTwice() public {
        _fund(e, BUDGET);
        _ready(e, 0);
        _claim(e, 0);
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.NotYetClaimable.selector);
        e.claim(0, BuildFundEscrow.PayoutAsset.MUSD, 0);
        vm.prank(contractor);
        vm.expectRevert(
            abi.encodeWithSelector(BuildFundEscrow.WrongStatus.selector, BuildFundEscrow.StageStatus.Paid)
        );
        e.requestRelease(0, bytes32("again"));
    }

    function test_refusesBtc_acceptsZeroValueCall() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(e).call{value: 1}("");
        assertFalse(ok);
        vm.prank(stranger);
        (ok,) = address(e).call{value: 0}("");
        assertTrue(ok); // MUSD ActivePool pings the recipient with 0 BTC on debt-only draws
    }

    function test_invalidStageId() public {
        vm.expectRevert(BuildFundEscrow.InvalidStage.selector);
        e.getStage(6);
    }

    // ------------------------------------------------------------- retention

    function _completeAll() internal {
        _fund(e, BUDGET);
        for (uint256 i; i < 6; ++i) {
            _ready(e, i);
            _claim(e, i);
        }
    }

    function test_retention_homeownerCanReleaseEarly() public {
        _completeAll();
        vm.prank(homeowner);
        e.releaseRetention();
        assertEq(musd.balanceOf(contractor), BUDGET);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.NothingToRelease.selector);
        e.releaseRetention();
    }

    function test_retention_notBeforeCompletion() public {
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.NotCompleted.selector);
        e.releaseRetention();
    }

    function test_retention_disputeAndSplit() public {
        _completeAll();
        uint256 held = e.retentionHeld(); // 196 MUSD
        vm.warp(block.timestamp + 365 days);
        vm.prank(homeowner);
        e.disputeRetention(bytes32("damp basement wall"));

        vm.warp(block.timestamp + WARRANTY);
        vm.prank(contractor);
        vm.expectRevert(BuildFundEscrow.RetentionIsDisputed.selector);
        e.releaseRetention();

        vm.prank(arbiter);
        e.resolveRetention(96e18);
        assertEq(musd.balanceOf(contractor), BUDGET - held + 96e18);
        assertEq(e.freeBalance(), held - 96e18);
        vm.prank(homeowner);
        e.withdrawFree(held - 96e18, homeowner);
        assertEq(e.principal(), 0);
        _assertAccounting(e);
    }

    function test_retention_disputeOnlyDuringWarranty() public {
        _completeAll();
        vm.warp(block.timestamp + WARRANTY);
        vm.prank(homeowner);
        vm.expectRevert(BuildFundEscrow.RetentionLocked.selector);
        e.disputeRetention(bytes32("too late"));
    }
}
