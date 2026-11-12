// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {BuildFundEscrow} from "./BuildFundEscrow.sol";
import {IMUSDSavingsRate} from "./interfaces/IMezo.sol";

/// @title Veridom Build Fund factory
/// @notice Deploys one minimal-proxy escrow per construction project, wired to the Mezo
///         protocol contracts fixed at deployment. Ownerless: no admin can change the wiring,
///         pause projects or touch funds.
contract BuildFundFactory {
    address public immutable implementation;

    address public immutable musd;
    address public immutable savingsVault;
    address public immutable pcv;
    address public immutable borrowerOpsSignatures;
    address public immutable troveManager;
    address public immutable priceFeed;
    address public immutable router;
    address public immutable poolFactory;
    address public immutable btc;

    address[] public allProjects;
    mapping(address => address[]) internal _projectsOf;
    mapping(address => bool) public isProject;

    event ProjectCreated(
        address indexed escrow,
        address indexed homeowner,
        address indexed contractor,
        address inspector,
        address arbiter,
        uint256 totalBudget,
        string title
    );

    error NotHomeowner();
    error VaultMismatch();

    constructor(BuildFundEscrow.Protocol memory p) {
        if (IMUSDSavingsRate(p.savingsVault).musdToken() != p.musd) revert VaultMismatch();
        implementation = address(new BuildFundEscrow());
        musd = p.musd;
        savingsVault = p.savingsVault;
        pcv = p.pcv;
        borrowerOpsSignatures = p.borrowerOpsSignatures;
        troveManager = p.troveManager;
        priceFeed = p.priceFeed;
        router = p.router;
        poolFactory = p.poolFactory;
        btc = p.btc;
    }

    function protocol() public view returns (BuildFundEscrow.Protocol memory) {
        return BuildFundEscrow.Protocol({
            musd: musd,
            savingsVault: savingsVault,
            pcv: pcv,
            borrowerOpsSignatures: borrowerOpsSignatures,
            troveManager: troveManager,
            priceFeed: priceFeed,
            router: router,
            poolFactory: poolFactory,
            btc: btc
        });
    }

    /// @notice The homeowner opens a Build Fund for her project with the contractor's
    ///         instalment plan. The contractor must accept on-chain before requesting payments.
    function createProject(
        BuildFundEscrow.Roles calldata roles,
        BuildFundEscrow.Terms calldata terms,
        BuildFundEscrow.StageInput[] calldata stages
    ) external returns (address escrow) {
        if (msg.sender != roles.homeowner) revert NotHomeowner();
        escrow = Clones.clone(implementation);
        BuildFundEscrow(payable(escrow)).initialize(protocol(), roles, terms, stages);

        isProject[escrow] = true;
        allProjects.push(escrow);
        _projectsOf[roles.homeowner].push(escrow);
        _projectsOf[roles.contractor].push(escrow);
        if (roles.inspector != address(0)) _projectsOf[roles.inspector].push(escrow);
        _projectsOf[roles.arbiter].push(escrow);

        uint256 total;
        for (uint256 i; i < stages.length; ++i) {
            total += stages[i].amount;
        }
        emit ProjectCreated(
            escrow, roles.homeowner, roles.contractor, roles.inspector, roles.arbiter, total, terms.title
        );
    }

    function projectsOf(address account) external view returns (address[] memory) {
        return _projectsOf[account];
    }

    function projectCount() external view returns (uint256) {
        return allProjects.length;
    }
}
