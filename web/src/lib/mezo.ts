import { zeroAddress, type Address, type Hex } from "viem";
import { MEZO, mezoTestnet } from "../config";
import { publicClient, type Signer } from "./wallet";
import {
  borrowerOperationsAbi,
  borrowerOpsSignaturesAbi,
  erc20Abi,
  hintHelpersAbi,
  routerAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from "../abi/mezo";

/** Insert-position hints for the MUSD sorted trove list (as in Mezo's integration guide). */
export async function troveHints(coll: bigint, principalDebt: bigint): Promise<[Address, Address]> {
  if (principalDebt === 0n) return [zeroAddress, zeroAddress];
  const nicr = (coll * 10n ** 20n) / principalDebt;
  try {
    const [approx] = await publicClient.readContract({
      address: MEZO.hintHelpers,
      abi: hintHelpersAbi,
      functionName: "getApproxHint",
      args: [nicr, 15n, BigInt(Math.floor(Math.random() * 1e9))],
    });
    const [upper, lower] = await publicClient.readContract({
      address: MEZO.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: "findInsertPosition",
      args: [nicr, approx, approx],
    });
    return [upper, lower];
  } catch {
    return [zeroAddress, zeroAddress]; // still valid, just more gas
  }
}

export async function openTroveArgs(collWei: bigint, debt: bigint) {
  const [fee, gasComp] = await Promise.all([
    publicClient.readContract({ address: MEZO.borrowerOperations, abi: borrowerOperationsAbi, functionName: "getBorrowingFee", args: [debt] }),
    publicClient.readContract({ address: MEZO.troveManager, abi: troveManagerAbi, functionName: "MUSD_GAS_COMPENSATION" }),
  ]);
  const [upper, lower] = await troveHints(collWei, debt + fee + gasComp);
  return { address: MEZO.borrowerOperations, abi: borrowerOperationsAbi, functionName: "openTrove", args: [debt, upper, lower], value: collWei } as const;
}

/** Hints for a debt increase/decrease of an existing trove. */
export async function adjustHints(borrower: Address, debtDelta: bigint): Promise<[Address, Address]> {
  const [coll, principal, , pendingColl, pendingPrincipal] = await publicClient.readContract({
    address: MEZO.troveManager,
    abi: troveManagerAbi,
    functionName: "getEntireDebtAndColl",
    args: [borrower],
  });
  const newPrincipal = principal + pendingPrincipal + debtDelta;
  return troveHints(coll + pendingColl, newPrincipal > 0n ? newPrincipal : 1n);
}

const bosDomain = {
  name: "BorrowerOperationsSignatures",
  version: "1",
  chainId: mezoTestnet.id,
  verifyingContract: MEZO.borrowerOpsSignatures,
} as const;

async function bosNonce(borrower: Address) {
  return publicClient.readContract({ address: MEZO.borrowerOpsSignatures, abi: borrowerOpsSignaturesAbi, functionName: "getNonce", args: [borrower] });
}

/** EIP-712 `WithdrawMUSD` authorisation: mint `amount` MUSD from the signer's trove to `recipient`. */
export async function signWithdrawMUSD(signer: Signer, amount: bigint, recipient: Address, deadline: bigint): Promise<Hex> {
  const nonce = await bosNonce(signer.address);
  return signer.client.signTypedData({
    account: signer.account,
    domain: bosDomain,
    types: {
      WithdrawMUSD: [
        { name: "amount", type: "uint256" },
        { name: "borrower", type: "address" },
        { name: "recipient", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "WithdrawMUSD",
    message: { amount, borrower: signer.address, recipient, nonce, deadline },
  });
}

/** EIP-712 `RepayMUSD` authorisation: the escrow (caller) burns `amount` MUSD against the signer's debt. */
export async function signRepayMUSD(signer: Signer, amount: bigint, deadline: bigint): Promise<Hex> {
  const nonce = await bosNonce(signer.address);
  return signer.client.signTypedData({
    account: signer.account,
    domain: bosDomain,
    types: {
      RepayMUSD: [
        { name: "amount", type: "uint256" },
        { name: "borrower", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "RepayMUSD",
    message: { amount, borrower: signer.address, nonce, deadline },
  });
}

/** EIP-2612 permit for MUSD so funding is a single transaction. */
export async function signMusdPermit(signer: Signer, spender: Address, value: bigint, deadline: bigint) {
  const nonce = await publicClient.readContract({ address: MEZO.musd, abi: erc20Abi, functionName: "nonces", args: [signer.address] });
  const sig = await signer.client.signTypedData({
    account: signer.account,
    domain: { name: "Mezo USD", version: "1", chainId: mezoTestnet.id, verifyingContract: MEZO.musd },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: signer.address, spender, value, nonce, deadline },
  });
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  const v = parseInt(sig.slice(130, 132), 16);
  return { v, r, s };
}

/** Live MUSD→BTC quote from the Mezo MUSD/BTC pool. */
export async function quoteMusdToBtc(amount: bigint): Promise<bigint> {
  const amounts = await publicClient.readContract({
    address: MEZO.router,
    abi: routerAbi,
    functionName: "getAmountsOut",
    args: [amount, [{ from: MEZO.musd, to: MEZO.btc, stable: false, factory: MEZO.poolFactory }]],
  });
  return amounts[amounts.length - 1];
}

export async function musdBalance(a: Address) {
  return publicClient.readContract({ address: MEZO.musd, abi: erc20Abi, functionName: "balanceOf", args: [a] });
}

export const deadlineIn = (seconds: number) => BigInt(Math.floor(Date.now() / 1000) + seconds);
