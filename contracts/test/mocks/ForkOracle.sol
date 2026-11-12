// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Stand-in for Mezo's BTC/USD oracle precompile (0x7b7c…0015) on a LOCAL anvil fork only
///      (scripts/local-fork.sh). Real testnet runs use the real precompile.
contract ForkOracle {
    function decimals() external pure returns (uint8) {
        return 18;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, 73_582e18, block.timestamp, block.timestamp, 1);
    }
}
