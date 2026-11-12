// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ITroveManager, IPriceFeed, IBorrowerOperations} from "./interfaces/IMezo.sol";

/// @title Trove health lens for Veridom Build Fund
/// @notice One call returns everything the web app needs to warn a homeowner before a draw:
///         collateral, debt, collateral ratio, liquidation price and the ratio after a
///         hypothetical extra draw. Pure view contract, no state.
contract BuildFundLens {
    uint256 public constant MCR = 1.1e18; // MUSD minimum collateral ratio (110 %)

    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IBorrowerOperations public immutable borrowerOperations;

    struct TroveHealth {
        uint8 status; // 0 none, 1 active, 2 closed, 3 liquidated, 4 redeemed
        uint256 price; // BTC/USD, 1e18
        uint256 coll; // BTC, 1e18 (incl. pending rewards)
        uint256 debt; // MUSD, 1e18 (principal + interest, incl. pending)
        uint256 icr; // 1e18 = 100 %
        uint256 liquidationPrice; // BTC price at which ICR hits 110 %
        uint16 interestRateBps;
        uint256 tcr; // system collateral ratio
        bool recoveryMode;
    }

    constructor(address troveManager_, address priceFeed_, address borrowerOperations_) {
        troveManager = ITroveManager(troveManager_);
        priceFeed = IPriceFeed(priceFeed_);
        borrowerOperations = IBorrowerOperations(borrowerOperations_);
    }

    function troveHealth(address borrower) public view returns (TroveHealth memory h) {
        h.price = priceFeed.fetchPrice();
        h.tcr = troveManager.getTCR(h.price);
        h.recoveryMode = troveManager.checkRecoveryMode(h.price);
        h.status = troveManager.getTroveStatus(borrower);
        if (h.status != 1) return h;
        (
            uint256 coll,
            uint256 principal,
            uint256 interest,
            uint256 pendingColl,
            uint256 pendingPrincipal,
            uint256 pendingInterest
        ) = troveManager.getEntireDebtAndColl(borrower);
        h.coll = coll + pendingColl;
        h.debt = principal + interest + pendingPrincipal + pendingInterest;
        h.icr = troveManager.getCurrentICR(borrower, h.price);
        h.interestRateBps = troveManager.getTroveInterestRate(borrower);
        if (h.coll > 0) h.liquidationPrice = (h.debt * MCR) / h.coll;
    }

    /// @notice Collateral ratio and liquidation price if the borrower drew `extra` MUSD now
    ///         (borrowing fee included).
    function afterDraw(address borrower, uint256 extra)
        external
        view
        returns (uint256 icrAfter, uint256 liquidationPriceAfter)
    {
        TroveHealth memory h = troveHealth(borrower);
        if (h.status != 1 || h.coll == 0) return (0, 0);
        uint256 debtAfter = h.debt + extra + borrowerOperations.getBorrowingFee(extra);
        icrAfter = (h.coll * h.price) / debtAfter;
        liquidationPriceAfter = (debtAfter * MCR) / h.coll;
    }
}
