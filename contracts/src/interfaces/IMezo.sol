// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Minimal interfaces to the Mezo protocol contracts used by Veridom Build Fund.
/// @notice Signatures were checked against the verified sources in github.com/mezo-org/musd
///         and the verified MUSDSavingsRate implementation on Mezo testnet (chain 31611).

/// @notice MUSD Savings Rate vault ("sMUSD").
/// @dev Not ERC-4626: deposits mint sMUSD 1:1, principal never changes, and yield is tracked
///      by a global `yieldIndex` and paid out in MUSD via `claimYield()`. `withdraw()` also
///      pays out any accrued yield on top of the principal.
interface IMUSDSavingsRate {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimYield() external returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function claimableYield(address account) external view returns (uint256);
    function supplyYieldIndex(address account) external view returns (uint256);
    function yieldIndex() external view returns (uint256);
    function musdToken() external view returns (address);
}

/// @notice Protocol Controlled Value. `distributeMUSD()` is permissionless and pushes the
///         savings share of accrued MUSD protocol fees into the Savings Rate vault.
interface IPCV {
    function distributeMUSD() external;
}

/// @notice EIP-712 "remote trove management" entry point of the MUSD protocol.
interface IBorrowerOperationsSignatures {
    function withdrawMUSDWithSignature(
        uint256 amount,
        address upperHint,
        address lowerHint,
        address borrower,
        address recipient,
        bytes memory signature,
        uint256 deadline
    ) external;

    function repayMUSDWithSignature(
        uint256 amount,
        address upperHint,
        address lowerHint,
        address borrower,
        bytes memory signature,
        uint256 deadline
    ) external;

    function getNonce(address user) external view returns (uint256);
}

interface IBorrowerOperations {
    function openTrove(uint256 debtAmount, address upperHint, address lowerHint) external payable;
    function withdrawMUSD(uint256 amount, address upperHint, address lowerHint) external;
    function repayMUSD(uint256 amount, address upperHint, address lowerHint) external;
    function minNetDebt() external view returns (uint256);
    function getBorrowingFee(uint256 debt) external view returns (uint256);
}

interface ITroveManager {
    function getCurrentICR(address borrower, uint256 price) external view returns (uint256);
    function getTroveStatus(address borrower) external view returns (uint8);
    function getEntireDebtAndColl(address borrower)
        external
        view
        returns (
            uint256 coll,
            uint256 principal,
            uint256 interest,
            uint256 pendingCollateral,
            uint256 pendingPrincipal,
            uint256 pendingInterest
        );
    function getTroveInterestRate(address borrower) external view returns (uint16);
    function getTCR(uint256 price) external view returns (uint256);
    function checkRecoveryMode(uint256 price) external view returns (bool);
    function MUSD_GAS_COMPENSATION() external view returns (uint256);
}

interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

/// @notice Mezo basic-pool router (Aerodrome-style).
interface IMezoRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, Route[] memory routes)
        external
        view
        returns (uint256[] memory amounts);
}
