// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BuildFundFactory} from "../src/BuildFundFactory.sol";
import {BuildFundEscrow} from "../src/BuildFundEscrow.sol";
import {BuildFundLens} from "../src/BuildFundLens.sol";
import {MezoTestnet as M} from "./MezoTestnet.sol";

/// @notice Deploys the Build Fund factory (+ escrow implementation) and the trove lens on
///         Mezo testnet and records the addresses in deployments/mezo-testnet.json.
///   PRIVATE_KEY=0x… forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast
contract Deploy is Script {
    function run() external {
        require(block.chainid == M.CHAIN_ID, "not Mezo testnet");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        BuildFundFactory factory = new BuildFundFactory(
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
        BuildFundLens lens = new BuildFundLens(M.TROVE_MANAGER, M.PRICE_FEED, M.BORROWER_OPERATIONS);
        vm.stopBroadcast();

        console2.log("BuildFundFactory", address(factory));
        console2.log("BuildFundEscrow implementation", factory.implementation());
        console2.log("BuildFundLens", address(lens));

        string memory j = "deployment";
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "deployedAtBlock", block.number);
        vm.serializeAddress(j, "factory", address(factory));
        vm.serializeAddress(j, "escrowImplementation", factory.implementation());
        string memory out = vm.serializeAddress(j, "lens", address(lens));
        vm.writeJson(out, vm.envOr("DEPLOY_OUT", string("./deployments/mezo-testnet.json")));
    }
}
