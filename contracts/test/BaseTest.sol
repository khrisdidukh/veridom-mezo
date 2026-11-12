// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BuildFundFactory} from "../src/BuildFundFactory.sol";
import {BuildFundEscrow} from "../src/BuildFundEscrow.sol";
import {BuildFundLens} from "../src/BuildFundLens.sol";
import {
    MockMUSD,
    MockBTC,
    MockSavingsRate,
    MockPCV,
    MockTroveManager,
    MockBorrowerOpsSignatures,
    MockRouter
} from "./mocks/Mocks.sol";

abstract contract BaseTest is Test {
    MockMUSD musd;
    MockBTC btc;
    MockSavingsRate vault;
    MockPCV pcv;
    MockTroveManager tm;
    MockBorrowerOpsSignatures bos;
    MockRouter router;
    BuildFundFactory factory;
    BuildFundLens lens;

    uint256 homeownerPk = 0xA11CE;
    address homeowner;
    address contractor = makeAddr("contractor");
    address inspector = makeAddr("inspector");
    address arbiter = makeAddr("arbiter");
    address stranger = makeAddr("stranger");

    uint32 constant REVIEW = 7 days;
    uint16 constant RETENTION_BPS = 200; // 2 % Haftruecklass (BTVG minimum)
    uint32 constant WARRANTY = 3 * 365 days;

    // Austrian BTVG Ratenplan B shares (10/30/20/12/17/9) on a 10,000 MUSD budget
    uint128[6] AMOUNTS = [uint128(1_000e18), 3_000e18, 2_000e18, 1_200e18, 1_700e18, 900e18];
    string[6] NAMES =
        ["Start of works", "Shell & roof", "Rough-in", "Facade & windows", "Ready to move in", "Completion"];
    uint256 constant BUDGET = 9_800e18;

    function setUp() public virtual {
        vm.warp(1_760_000_000);
        homeowner = vm.addr(homeownerPk);
        musd = new MockMUSD();
        btc = new MockBTC();
        vault = new MockSavingsRate(address(musd));
        pcv = new MockPCV(address(musd), address(vault));
        tm = new MockTroveManager();
        bos = new MockBorrowerOpsSignatures(address(musd), address(tm));
        musd.setMinter(address(bos), true);
        router = new MockRouter(address(tm), address(btc));
        factory = new BuildFundFactory(_protocol(address(router)));
        lens = new BuildFundLens(address(tm), address(tm), address(tm));

        // a different saver so the vault has outside supply, like on testnet
        address saver = makeAddr("saver");
        musd.mint(saver, 90_000e18);
        vm.startPrank(saver);
        musd.approve(address(vault), type(uint256).max);
        vault.deposit(90_000e18);
        vm.stopPrank();
    }

    function _protocol(address router_) internal view returns (BuildFundEscrow.Protocol memory) {
        return BuildFundEscrow.Protocol({
            musd: address(musd),
            savingsVault: address(vault),
            pcv: address(pcv),
            borrowerOpsSignatures: address(bos),
            troveManager: address(tm),
            priceFeed: address(tm),
            router: router_,
            poolFactory: address(0xFAC),
            btc: address(btc)
        });
    }

    function _roles(bool withInspector) internal view returns (BuildFundEscrow.Roles memory) {
        return BuildFundEscrow.Roles({
            homeowner: homeowner,
            contractor: contractor,
            inspector: withInspector ? inspector : address(0),
            arbiter: arbiter
        });
    }

    function _terms() internal pure returns (BuildFundEscrow.Terms memory) {
        return BuildFundEscrow.Terms({
            reviewWindow: REVIEW,
            retentionBps: RETENTION_BPS,
            warrantyPeriod: WARRANTY,
            minIcrAfterDraw: 1.6e18,
            title: "Single-family house, Franzen",
            metadataURI: "https://veridom.space"
        });
    }

    function _stages() internal view returns (BuildFundEscrow.StageInput[] memory s) {
        s = new BuildFundEscrow.StageInput[](6);
        for (uint256 i; i < 6; ++i) {
            s[i] = BuildFundEscrow.StageInput({
                name: NAMES[i],
                amount: AMOUNTS[i],
                deadline: uint64(block.timestamp + (i + 1) * 60 days)
            });
        }
    }

    function _create(bool withInspector) internal returns (BuildFundEscrow e) {
        vm.prank(homeowner);
        e = BuildFundEscrow(payable(factory.createProject(_roles(withInspector), _terms(), _stages())));
    }

    function _fund(BuildFundEscrow e, uint256 amount) internal {
        musd.mint(homeowner, amount);
        vm.startPrank(homeowner);
        musd.approve(address(e), amount);
        e.fund(amount);
        vm.stopPrank();
    }

    function _ready(BuildFundEscrow e, uint256 id) internal {
        if (!e.contractorAccepted()) {
            vm.prank(contractor);
            e.acceptProject();
        }
        vm.prank(contractor);
        e.requestRelease(id, keccak256(abi.encode("evidence", id)));
        vm.prank(homeowner);
        e.approve(id);
        (,, address insp,) = e.roles();
        if (insp != address(0)) {
            vm.prank(inspector);
            e.inspect(id, true, bytes32("ok"));
        }
    }

    function _claim(BuildFundEscrow e, uint256 id) internal {
        vm.prank(contractor);
        e.claim(id, BuildFundEscrow.PayoutAsset.MUSD, 0);
    }

    function _signWithdraw(uint256 amount, address recipient, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = bos.digestWithdraw(amount, homeowner, recipient, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(homeownerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signRepay(uint256 amount, uint256 deadline) internal view returns (bytes memory) {
        bytes32 digest = bos.digestRepay(amount, homeowner, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(homeownerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Core accounting invariants that must hold after every action.
    function _assertAccounting(BuildFundEscrow e) internal view {
        assertEq(vault.balanceOf(address(e)), e.principal(), "sMUSD == principal");
        assertEq(musd.balanceOf(address(e)), 0, "no stranded MUSD in escrow");
        assertEq(
            e.freeBalance() + e.committed() + e.retentionHeld(),
            e.principal() + e.shortfall(),
            "free + locked == principal + shortfall"
        );
    }
}
