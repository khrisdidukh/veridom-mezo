import { type Address, type Hash } from "viem";
import escrowAbiJson from "../abi/BuildFundEscrow.json";
import factoryAbiJson from "../abi/BuildFundFactory.json";
import lensAbiJson from "../abi/BuildFundLens.json";
import { deployment } from "../config";
import { publicClient } from "./wallet";

export const escrowAbi = escrowAbiJson as readonly unknown[] as typeof escrowAbiJson;
export const factoryAbi = factoryAbiJson;
export const lensAbi = lensAbiJson;

export const STAGE_STATUS = ["Pending", "Requested", "Rejected", "Approved", "Disputed", "Paid", "Cancelled"] as const;
export type StageStatus = (typeof STAGE_STATUS)[number];

export type Stage = {
  id: number;
  name: string;
  amount: bigint;
  deadline: number;
  requestedAt: number;
  status: StageStatus;
  homeownerApproved: boolean;
  inspectorApproved: boolean;
  evidenceHash: Hash;
  paidToContractor: bigint;
  claimable: boolean;
};

export type Project = {
  address: Address;
  homeowner: Address;
  contractor: Address;
  inspector: Address;
  arbiter: Address;
  title: string;
  metadataURI: string;
  reviewWindow: number;
  retentionBps: number;
  warrantyPeriod: number;
  minIcrAfterDraw: bigint;
  contractorAccepted: boolean;
  principal: bigint;
  committed: bigint;
  retentionHeld: bigint;
  freeBalance: bigint;
  shortfall: bigint;
  totalFunded: bigint;
  totalDrawnFromTrove: bigint;
  totalPaidToContractor: bigint;
  totalYieldPaid: bigint;
  totalRepaidToTrove: bigint;
  pendingYield: bigint;
  completedAt: number;
  retentionDisputed: boolean;
  budget: bigint;
  stages: Stage[];
};

export type TroveHealth = {
  status: number;
  price: bigint;
  coll: bigint;
  debt: bigint;
  icr: bigint;
  liquidationPrice: bigint;
  interestRateBps: number;
  tcr: bigint;
  recoveryMode: boolean;
};

type RawStage = {
  name: string;
  amount: bigint;
  deadline: bigint;
  requestedAt: bigint;
  status: number;
  homeownerApproved: boolean;
  inspectorApproved: boolean;
  evidenceHash: Hash;
  paidToContractor: bigint;
};

export async function loadProject(address: Address): Promise<Project> {
  const c = { address, abi: escrowAbiJson } as const;
  const names = [
    "roles",
    "terms",
    "contractorAccepted",
    "principal",
    "committed",
    "retentionHeld",
    "freeBalance",
    "shortfall",
    "totalFunded",
    "totalDrawnFromTrove",
    "totalPaidToContractor",
    "totalYieldPaid",
    "totalRepaidToTrove",
    "pendingYield",
    "completedAt",
    "retentionDisputed",
    "getStages",
  ] as const;
  const results = await publicClient.multicall({
    contracts: names.map((functionName) => ({ ...c, functionName })) as never,
    allowFailure: false,
  });
  const r = Object.fromEntries(names.map((n, i) => [n, (results as unknown[])[i]])) as unknown as Record<(typeof names)[number], unknown>;
  const [homeowner, contractor, inspector, arbiter] = r.roles as [Address, Address, Address, Address];
  const [reviewWindow, retentionBps, warrantyPeriod, minIcrAfterDraw, title, metadataURI] = r.terms as [
    number, number, number, bigint, string, string,
  ];
  const raw = r.getStages as RawStage[];
  const claimables = await publicClient.multicall({
    contracts: raw.map((_, i) => ({ ...c, functionName: "isClaimable", args: [BigInt(i)] })) as never,
    allowFailure: false,
  });
  const stages: Stage[] = raw.map((s, i) => ({
    id: i,
    name: s.name,
    amount: s.amount,
    deadline: Number(s.deadline),
    requestedAt: Number(s.requestedAt),
    status: STAGE_STATUS[s.status],
    homeownerApproved: s.homeownerApproved,
    inspectorApproved: s.inspectorApproved,
    evidenceHash: s.evidenceHash,
    paidToContractor: s.paidToContractor,
    claimable: Boolean(claimables[i]),
  }));
  return {
    address,
    homeowner,
    contractor,
    inspector,
    arbiter,
    title,
    metadataURI,
    reviewWindow: Number(reviewWindow),
    retentionBps: Number(retentionBps),
    warrantyPeriod: Number(warrantyPeriod),
    minIcrAfterDraw,
    contractorAccepted: r.contractorAccepted as boolean,
    principal: r.principal as bigint,
    committed: r.committed as bigint,
    retentionHeld: r.retentionHeld as bigint,
    freeBalance: r.freeBalance as bigint,
    shortfall: r.shortfall as bigint,
    totalFunded: r.totalFunded as bigint,
    totalDrawnFromTrove: r.totalDrawnFromTrove as bigint,
    totalPaidToContractor: r.totalPaidToContractor as bigint,
    totalYieldPaid: r.totalYieldPaid as bigint,
    totalRepaidToTrove: r.totalRepaidToTrove as bigint,
    pendingYield: r.pendingYield as bigint,
    completedAt: Number(r.completedAt as bigint),
    retentionDisputed: r.retentionDisputed as boolean,
    budget: stages.reduce((a, s) => a + s.amount, 0n),
    stages,
  };
}

export async function loadTroveHealth(borrower: Address): Promise<TroveHealth | null> {
  if (!deployment.lens) return null;
  const h = (await publicClient.readContract({
    address: deployment.lens,
    abi: lensAbiJson,
    functionName: "troveHealth",
    args: [borrower],
  })) as TroveHealth;
  return { ...h, status: Number(h.status), interestRateBps: Number(h.interestRateBps) };
}

export async function previewDraw(borrower: Address, amount: bigint): Promise<{ icr: bigint; liq: bigint } | null> {
  if (!deployment.lens || amount === 0n) return null;
  const [icr, liq] = (await publicClient.readContract({
    address: deployment.lens,
    abi: lensAbiJson,
    functionName: "afterDraw",
    args: [borrower, amount],
  })) as [bigint, bigint];
  return { icr, liq };
}

export type ActivityItem = { block: bigint; tx: Hash; event: string; args: Record<string, unknown>; time?: number };

/** Escrow events, fetched in 10k-block windows (Mezo RPC limit). */
export async function loadActivity(address: Address, maxWindows = 40): Promise<ActivityItem[]> {
  const latest = await publicClient.getBlockNumber();
  const start = BigInt(deployment.deployedAtBlock || 0);
  const windows: [bigint, bigint][] = [];
  for (let to = latest; to >= start && windows.length < maxWindows; to -= 10_000n) {
    const from = to - 9_999n > start ? to - 9_999n : start;
    windows.push([from, to]);
    if (from === start) break;
  }
  const chunks = await Promise.all(
    windows.map(([fromBlock, toBlock]) =>
      publicClient.getContractEvents({ address, abi: escrowAbiJson, fromBlock, toBlock }).catch(() => []),
    ),
  );
  const logs = chunks.flat();
  const items = logs.map((l) => ({
    block: l.blockNumber as bigint,
    tx: l.transactionHash as Hash,
    event: (l as unknown as { eventName: string }).eventName,
    args: ((l as unknown as { args: Record<string, unknown> }).args ?? {}) as Record<string, unknown>,
  }));
  items.sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1));
  const blocks = [...new Set(items.slice(0, 40).map((i) => i.block))];
  const times = new Map<bigint, number>();
  await Promise.all(
    blocks.map(async (b) => {
      const blk = await publicClient.getBlock({ blockNumber: b }).catch(() => null);
      if (blk) times.set(b, Number(blk.timestamp));
    }),
  );
  return items.map((i) => ({ ...i, time: times.get(i.block) }));
}

export async function projectsOf(account: Address): Promise<Address[]> {
  if (!deployment.factory) return [];
  return (await publicClient.readContract({
    address: deployment.factory,
    abi: factoryAbiJson,
    functionName: "projectsOf",
    args: [account],
  })) as Address[];
}

export async function allProjects(): Promise<Address[]> {
  if (!deployment.factory) return [];
  const n = (await publicClient.readContract({ address: deployment.factory, abi: factoryAbiJson, functionName: "projectCount" })) as bigint;
  const ids = Array.from({ length: Number(n) }, (_, i) => BigInt(i));
  const res = await publicClient.multicall({
    contracts: ids.map((i) => ({ address: deployment.factory!, abi: factoryAbiJson, functionName: "allProjects", args: [i] })) as never,
    allowFailure: false,
  });
  return res as Address[];
}
