import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function nonces(address owner) view returns (uint256)",
]);

export const borrowerOperationsAbi = parseAbi([
  "function openTrove(uint256 debtAmount, address upperHint, address lowerHint) payable",
  "function getBorrowingFee(uint256 debt) view returns (uint256)",
  "function minNetDebt() view returns (uint256)",
]);

export const borrowerOpsSignaturesAbi = parseAbi(["function getNonce(address user) view returns (uint256)"]);

export const troveManagerAbi = parseAbi([
  "function MUSD_GAS_COMPENSATION() view returns (uint256)",
  "function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
]);

export const hintHelpersAbi = parseAbi([
  "function getApproxHint(uint256 CR, uint256 numTrials, uint256 inputRandomSeed) view returns (address hintAddress, uint256 diff, uint256 latestRandomSeed)",
]);

export const sortedTrovesAbi = parseAbi([
  "function findInsertPosition(uint256 NICR, address prevId, address nextId) view returns (address, address)",
]);

export const routerAbi = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)",
]);

export const savingsRateAbi = parseAbi([
  "function yieldIndex() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
