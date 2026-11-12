// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "./BaseTest.sol";
import {BuildFundEscrow} from "../src/BuildFundEscrow.sol";
import {MockMUSD, MockSavingsRate, MockPCV} from "./mocks/Mocks.sol";
import {Test} from "forge-std/Test.sol";

/// @dev Drives random sequences of real-world actions against one escrow.
contract Handler is Test {
    BuildFundEscrow public e;
    MockMUSD musd;
    MockSavingsRate vault;
    MockPCV pcv;
    address homeowner;
    address contractor;
    address inspector;
    address arbiter;

    uint256 public withdrawnByHomeowner;

    constructor(
        BuildFundEscrow e_,
        MockMUSD musd_,
        MockSavingsRate vault_,
        MockPCV pcv_,
        address h,
        address c,
        address i,
        address a
    ) {
        e = e_;
        musd = musd_;
        vault = vault_;
        pcv = pcv_;
        homeowner = h;
        contractor = c;
        inspector = i;
        arbiter = a;
        vm.prank(contractor);
        e.acceptProject();
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 1e18, 5_000e18);
        musd.mint(homeowner, amount);
        vm.startPrank(homeowner);
        musd.approve(address(e), amount);
        e.fund(amount);
        vm.stopPrank();
    }

    function accrueYield(uint256 amount) external {
        amount = bound(amount, 1e18, 2_000e18);
        musd.mint(address(pcv), amount);
        e.harvest();
    }

    function request(uint256 id) external {
        id = bound(id, 0, 5);
        BuildFundEscrow.StageStatus st = e.getStage(id).status;
        if (st != BuildFundEscrow.StageStatus.Pending && st != BuildFundEscrow.StageStatus.Rejected) {
            return;
        }
        vm.prank(contractor);
        e.requestRelease(id, keccak256(abi.encode(id, block.timestamp)));
    }

    function approveAndInspect(uint256 id, bool pass) external {
        id = bound(id, 0, 5);
        if (e.getStage(id).status != BuildFundEscrow.StageStatus.Requested) return;
        vm.prank(homeowner);
        e.approve(id);
        vm.prank(inspector);
        e.inspect(id, pass, bytes32("note"));
    }

    function claim(uint256 id) external {
        id = bound(id, 0, 5);
        if (!e.isClaimable(id)) return;
        if (e.principal() - e.retentionHeld() < e.getStage(id).amount) return;
        vm.prank(contractor);
        e.claim(id, BuildFundEscrow.PayoutAsset.MUSD, 0);
    }

    function disputeAndResolve(uint256 id, uint256 award) external {
        id = bound(id, 0, 5);
        BuildFundEscrow.Stage memory s = e.getStage(id);
        if (s.status != BuildFundEscrow.StageStatus.Requested && s.status != BuildFundEscrow.StageStatus.Rejected) {
            return;
        }
        vm.prank(contractor);
        e.dispute(id, bytes32("d"));
        award = bound(award, 0, s.amount);
        if (e.principal() - e.retentionHeld() < award) award = e.principal() - e.retentionHeld();
        vm.prank(arbiter);
        e.resolveDispute(id, award);
    }

    function warp(uint256 secs) external {
        secs = bound(secs, 1 hours, 120 days);
        vm.warp(block.timestamp + secs);
    }

    function cancel(uint256 id) external {
        id = bound(id, 0, 5);
        BuildFundEscrow.Stage memory s = e.getStage(id);
        if (block.timestamp <= s.deadline) return;
        if (s.status != BuildFundEscrow.StageStatus.Pending && s.status != BuildFundEscrow.StageStatus.Rejected) {
            return;
        }
        vm.prank(homeowner);
        e.cancelStage(id);
    }

    function withdrawFree(uint256 amount) external {
        uint256 free = e.freeBalance();
        if (free == 0) return;
        amount = bound(amount, 1, free);
        vm.prank(homeowner);
        e.withdrawFree(amount, homeowner);
        withdrawnByHomeowner += amount;
    }

    function releaseRetention() external {
        if (e.completedAt() == 0 || e.retentionHeld() == 0) return;
        vm.prank(homeowner);
        e.releaseRetention();
    }
}

contract BuildFundInvariantTest is BaseTest {
    BuildFundEscrow e;
    Handler h;

    function setUp() public override {
        super.setUp();
        e = _create(true);
        h = new Handler(e, musd, vault, pcv, homeowner, contractor, inspector, arbiter);
        targetContract(address(h));
    }

    /// The escrow's sMUSD always equals its tracked principal and it never strands MUSD.
    function invariant_vaultSharesMatchPrincipal() public view {
        assertEq(vault.balanceOf(address(e)), e.principal());
        assertEq(musd.balanceOf(address(e)), 0);
    }

    /// Every MUSD that came in is either still parked, paid to the contractor, or returned.
    function invariant_moneyIsConserved() public view {
        assertEq(
            e.totalFunded(),
            e.principal() + e.totalPaidToContractor() + h.withdrawnByHomeowner() + e.totalRepaidToTrove()
        );
    }

    /// Committed budget never exceeds the sum of open stage amounts, and paid never exceeds plan.
    function invariant_commitmentsConsistent() public view {
        uint256 open;
        uint256 paidNet;
        for (uint256 i; i < e.stageCount(); ++i) {
            BuildFundEscrow.Stage memory s = e.getStage(i);
            if (s.status != BuildFundEscrow.StageStatus.Paid && s.status != BuildFundEscrow.StageStatus.Cancelled) {
                open += s.amount;
            }
            paidNet += s.paidToContractor;
            assertLe(s.paidToContractor, s.amount);
        }
        assertEq(e.committed(), open);
        assertLe(paidNet, BUDGET);
        assertLe(e.retentionHeld(), e.principal());
    }
}
