// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BuildFundFactory} from "../../src/BuildFundFactory.sol";
import {BuildFundEscrow} from "../../src/BuildFundEscrow.sol";
import {BuildFundLens} from "../../src/BuildFundLens.sol";
import {
    IMUSDSavingsRate,
    IBorrowerOperations,
    IBorrowerOperationsSignatures,
    IMezoRouter,
    ITroveManager
} from "../../src/interfaces/IMezo.sol";
import {MezoTestnet as M} from "../../script/MezoTestnet.sol";

/// @notice Runs Build Fund against the REAL Mezo testnet contracts on a local fork:
///         MUSD, MUSD Savings Rate vault, PCV, BorrowerOperations(+Signatures), TroveManager,
///         PriceFeed and the MUSD/BTC pool router.
///         Run: forge test --match-path "test/fork/*" --fork-url https://rpc.test.mezo.org
contract MezoForkTest is Test {
    BuildFundFactory factory;
    BuildFundLens lens;
    BuildFundEscrow e;
    IERC20 musd = IERC20(M.MUSD);
    IMUSDSavingsRate vault = IMUSDSavingsRate(M.SAVINGS_RATE);

    uint256 homeownerPk = 0xB0B;
    address homeowner;
    address contractor = makeAddr("contractor");
    address inspector = makeAddr("inspector");
    address arbiter = makeAddr("arbiter");

    bytes32 constant WITHDRAW_TYPEHASH = keccak256(
        "WithdrawMUSD(uint256 amount,address borrower,address recipient,uint256 nonce,uint256 deadline)"
    );
    bytes32 constant REPAY_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");

    function setUp() public {
        if (block.chainid != M.CHAIN_ID) {
            vm.skip(true);
            return;
        }
        homeowner = vm.addr(homeownerPk);
        _mockOracle();
        factory = new BuildFundFactory(
            BuildFundEscrow.Protocol({
                musd: M.MUSD,
                savingsVault: M.SAVINGS_RATE,
                pcv: M.PCV,
                borrowerOpsSignatures: M.BORROWER_OPS_SIGNATURES,
                troveManager: M.TROVE_MANAGER,
                priceFeed: M.PRICE_FEED,
                router: M.ROUTER,
                poolFactory: M.POOL_FACTORY,
                btc: M.BTC
            })
        );
        lens = new BuildFundLens(M.TROVE_MANAGER, M.PRICE_FEED, M.BORROWER_OPERATIONS);

        BuildFundEscrow.StageInput[] memory s = new BuildFundEscrow.StageInput[](3);
        s[0] = BuildFundEscrow.StageInput("Start of works", 1_000e18, uint64(block.timestamp + 30 days));
        s[1] = BuildFundEscrow.StageInput("Shell & roof", 3_000e18, uint64(block.timestamp + 90 days));
        s[2] = BuildFundEscrow.StageInput("Completion", 1_000e18, uint64(block.timestamp + 180 days));
        vm.prank(homeowner);
        e = BuildFundEscrow(payable(
            factory.createProject(
                BuildFundEscrow.Roles(homeowner, contractor, inspector, arbiter),
                BuildFundEscrow.Terms(3 days, 200, 365 days, 1.5e18, "Fork test house", "https://veridom.space"),
                s
            )
        ));
        vm.prank(contractor);
        e.acceptProject();
    }

    /// @dev Mezo's BTC/USD oracle is a chain precompile (0x7b7c…0015) that a local EVM fork
    ///      cannot execute, so it is mocked with the live testnet value read on 12 Nov 2026.
    ///      On the real testnet (see script/Demo.s.sol) the precompile is used as-is.
    function _mockOracle() internal {
        address oracle = 0x7b7c000000000000000000000000000000000015;
        vm.mockCall(oracle, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        vm.mockCall(
            oracle,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), int256(73_582e18), block.timestamp, block.timestamp, uint80(1))
        );
    }

    function _openTrove(uint256 collBtc, uint256 debt) internal {
        vm.deal(homeowner, collBtc + 1 ether);
        vm.prank(homeowner);
        IBorrowerOperations(M.BORROWER_OPERATIONS).openTrove{value: collBtc}(debt, address(0), address(0));
    }

    function _sign(bytes32 structHash) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("BorrowerOperationsSignatures"),
                keccak256("1"),
                block.chainid,
                M.BORROWER_OPS_SIGNATURES
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(homeownerPk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function test_fork_realTroveDrawIntoEscrow_andGuard() public {
        _openTrove(0.2 ether, 3_000e18); // ~0.2 BTC @ ~73k vs ~3.2k debt
        BuildFundLens.TroveHealth memory h0 = lens.troveHealth(homeowner);
        assertEq(h0.status, 1);
        assertGt(h0.icr, 3e18);

        uint256 nonce = IBorrowerOperationsSignatures(M.BORROWER_OPS_SIGNATURES).getNonce(homeowner);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(
            keccak256(abi.encode(WITHDRAW_TYPEHASH, 5_000e18, homeowner, address(e), nonce, deadline))
        );
        e.drawFromTrove(5_000e18, address(0), address(0), deadline, sig); // relayed by anyone
        assertEq(e.principal(), 5_000e18);
        assertEq(vault.balanceOf(address(e)), 5_000e18, "parked in the real sMUSD vault");
        BuildFundLens.TroveHealth memory h1 = lens.troveHealth(homeowner);
        assertGt(h1.debt, h0.debt + 5_000e18 - 1);
        assertGe(h1.icr, 1.5e18);

        // a draw that would push the trove below the 150 % guard is rejected on-chain
        nonce = IBorrowerOperationsSignatures(M.BORROWER_OPS_SIGNATURES).getNonce(homeowner);
        sig = _sign(keccak256(abi.encode(WITHDRAW_TYPEHASH, 2_000e18, homeowner, address(e), nonce, deadline)));
        vm.expectPartialRevert(BuildFundEscrow.DrawGuard.selector);
        e.drawFromTrove(2_000e18, address(0), address(0), deadline, sig);
    }

    function test_fork_fullFlow_realVaultYield_deemedAcceptance_repay() public {
        _openTrove(0.3 ether, 2_000e18);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(
            keccak256(abi.encode(WITHDRAW_TYPEHASH, 6_000e18, homeowner, address(e), 0, deadline))
        );
        e.drawFromTrove(6_000e18, address(0), address(0), deadline, sig);
        assertEq(e.freeBalance(), 1_000e18);

        // real protocol yield: PCV holds accrued MUSD fees; harvest pokes distribution
        uint256 homeownerBefore = musd.balanceOf(homeowner);
        uint256 got = e.harvest();
        emit log_named_uint("yield harvested from real PCV->sMUSD (wei)", got);
        assertEq(musd.balanceOf(homeowner) - homeownerBefore, got);

        // stage 0: approved by homeowner + inspector, paid in MUSD
        vm.prank(contractor);
        e.requestRelease(0, keccak256("veridom checkpoint #1"));
        vm.prank(homeowner);
        e.approve(0);
        vm.prank(inspector);
        e.inspect(0, true, keccak256("site visit"));
        vm.prank(contractor);
        e.claim(0, BuildFundEscrow.PayoutAsset.MUSD, 0);
        assertEq(musd.balanceOf(contractor), 980e18);

        // stage 1: deemed accepted after the review window (homeowner silent, inspector ok).
        // NOTE: the BTC payout path is exercised on the real testnet by script/Demo.s.sol —
        // BTC on Mezo is a chain precompile that a local fork cannot execute. Here we check the
        // live MUSD/BTC pool quote the web app uses for the contractor's slippage limit.
        vm.prank(contractor);
        e.requestRelease(1, keccak256("veridom checkpoint #2"));
        vm.prank(inspector);
        e.inspect(1, true, keccak256("site visit 2"));
        vm.warp(block.timestamp + 3 days);
        _mockOracle();
        IMezoRouter.Route[] memory routes = new IMezoRouter.Route[](1);
        routes[0] = IMezoRouter.Route(M.MUSD, M.BTC, false, M.POOL_FACTORY);
        uint256 quote = IMezoRouter(M.ROUTER).getAmountsOut(2_940e18, routes)[1];
        emit log_named_uint("live pool quote, BTC wei for 2,940 MUSD", quote);
        assertGt(quote, 0);
        assertTrue(e.isClaimable(1));
        vm.prank(contractor);
        e.claim(1, BuildFundEscrow.PayoutAsset.MUSD, 0);
        assertEq(musd.balanceOf(contractor), 980e18 + 2_940e18);

        // leftover 1,000 MUSD repays the trove directly through a RepayMUSD signature
        uint256 debtBefore = lens.troveHealth(homeowner).debt;
        sig = _sign(keccak256(abi.encode(REPAY_TYPEHASH, 1_000e18, homeowner, 1, deadline + 3 days)));
        vm.prank(homeowner);
        e.repayTroveFromFree(1_000e18, address(0), address(0), deadline + 3 days, sig);
        assertLe(lens.troveHealth(homeowner).debt, debtBefore - 1_000e18 + 1e18);
        assertEq(vault.balanceOf(address(e)), e.principal());
        assertEq(musd.balanceOf(address(e)), 0);
    }

    function test_fork_lensMatchesTroveManager() public {
        _openTrove(0.1 ether, 2_000e18);
        BuildFundLens.TroveHealth memory h = lens.troveHealth(homeowner);
        uint256 icr = ITroveManager(M.TROVE_MANAGER).getCurrentICR(homeowner, h.price);
        assertEq(h.icr, icr);
        assertApproxEqRel(h.liquidationPrice, h.debt * 1.1e18 / h.coll, 1e12);
        (uint256 icrAfter,) = lens.afterDraw(homeowner, 1_000e18);
        assertLt(icrAfter, h.icr);
    }
}
