#!/usr/bin/env node
/**
 * End-to-end on-chain demo of Veridom Build Fund on Mezo testnet (or a local fork).
 *
 * Exercises every escrow feature with real Mezo contracts and four separate wallets
 * (homeowner, contractor, inspector, arbiter/relayer) and records each transaction hash in
 *   contracts/deployments/demo-run.json   and   web/src/deployment.json
 *
 * Usage (from web/):
 *   node scripts/onchain-demo.mjs                         # real Mezo testnet
 *   node scripts/onchain-demo.mjs --rpc http://127.0.0.1:8545 --local   # anvil fork
 *
 * Private keys are read from ../keys/*.key (gitignored) and never printed.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  toBytes,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const LOCAL = args.includes("--local");
const RPC = opt("--rpc", "https://rpc.test.mezo.org");
const ONLY = opt("--only", "all"); // all | A | B
const EXPLORER = "https://explorer.test.mezo.org";

const M = {
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  btc: "0x7b7C000000000000000000000000000000000000",
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  borrowerOpsSignatures: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  router: "0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9",
  poolFactory: "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A",
};

const chain = {
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
};

const escrowAbi = JSON.parse(readFileSync(join(ROOT, "web/src/abi/BuildFundEscrow.json"), "utf8"));
const factoryAbi = JSON.parse(readFileSync(join(ROOT, "web/src/abi/BuildFundFactory.json"), "utf8"));
const lensAbi = JSON.parse(readFileSync(join(ROOT, "web/src/abi/BuildFundLens.json"), "utf8"));
const mezoAbi = parseAbi([
  "function openTrove(uint256 debtAmount, address upperHint, address lowerHint) payable",
  "function getBorrowingFee(uint256) view returns (uint256)",
  "function getNonce(address) view returns (uint256)",
  "function getApproxHint(uint256 CR, uint256 numTrials, uint256 inputRandomSeed) view returns (address, uint256, uint256)",
  "function findInsertPosition(uint256 NICR, address prevId, address nextId) view returns (address, address)",
  "function getEntireDebtAndColl(address) view returns (uint256, uint256, uint256, uint256, uint256, uint256)",
  "function getTroveStatus(address) view returns (uint8)",
  "function fetchPrice() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "struct Route { address from; address to; bool stable; address factory; }",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)",
]);

const pub = createPublicClient({ chain, transport: http(RPC) });
const key = (n) => readFileSync(join(ROOT, "keys", `${n}.key`), "utf8").trim();
const acct = (n) => privateKeyToAccount(key(n));
const W = {};
for (const n of ["deployer", "homeowner", "contractor", "inspector"]) {
  const account = acct(n);
  W[n] = { name: n, account, address: account.address, client: createWalletClient({ account, chain, transport: http(RPC) }) };
}
W.arbiter = { ...W.deployer, name: "arbiter (Veridom mediator)" };
W.relayer = { ...W.deployer, name: "relayer" };

const deployment = JSON.parse(readFileSync(join(ROOT, "contracts/deployments", LOCAL ? "local-fork.json" : "mezo-testnet.json"), "utf8"));
const runFile = join(ROOT, "contracts/deployments", LOCAL ? "demo-run-local.json" : "demo-run.json");
const log = existsSync(runFile) ? JSON.parse(readFileSync(runFile, "utf8")) : { network: LOCAL ? "local-fork" : "mezo-testnet", txs: [], projects: {} };
const save = () => writeFileSync(runFile, JSON.stringify(log, null, 2) + "\n");

const fmt = (v, d = 2) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: d });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (s) => keccak256(toBytes(s));
const nowS = async () => Number((await pub.getBlock()).timestamp);

async function tx(label, w, req) {
  const { request } = await pub.simulateContract({ ...req, account: w.account });
  const hash = await w.client.writeContract(request);
  const r = await receipt(hash);
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  log.txs.push({ label, from: w.name, hash, block: Number(r.blockNumber) });
  save();
  console.log(`  ✓ ${label.padEnd(58)} ${LOCAL ? hash : `${EXPLORER}/tx/${hash}`}`);
  return r;
}

async function receipt(hash) {
  for (let i = 0; i < 90; i++) {
    try {
      return await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    } catch (e) {
      await sleep(2000);
    }
  }
  throw new Error(`no receipt for ${hash}`);
}

async function sendBtc(label, from, to, value) {
  const hash = await from.client.sendTransaction({ to, value });
  const r = await pub.waitForTransactionReceipt({ hash });
  log.txs.push({ label, from: from.name, hash, block: Number(r.blockNumber) });
  save();
  console.log(`  ✓ ${label.padEnd(58)} ${LOCAL ? hash : `${EXPLORER}/tx/${hash}`}`);
}

async function waitSeconds(s) {
  if (LOCAL) {
    await pub.request({ method: "evm_increaseTime", params: [s] });
    await pub.request({ method: "evm_mine", params: [] });
  } else {
    console.log(`  … waiting ${s}s for the review window to pass (real time on testnet)`);
    await sleep(s * 1000);
  }
}

async function hints(borrower, debtDelta) {
  const [coll, principal, , pColl, pPrincipal] = await pub.readContract({ address: M.troveManager, abi: mezoAbi, functionName: "getEntireDebtAndColl", args: [borrower] });
  const nicr = ((coll + pColl) * 10n ** 20n) / (principal + pPrincipal + debtDelta);
  const [approx] = await pub.readContract({ address: M.hintHelpers, abi: mezoAbi, functionName: "getApproxHint", args: [nicr, 15n, 42n] });
  return pub.readContract({ address: M.sortedTroves, abi: mezoAbi, functionName: "findInsertPosition", args: [nicr, approx, approx] });
}

const bosDomain = { name: "BorrowerOperationsSignatures", version: "1", chainId: 31611, verifyingContract: M.borrowerOpsSignatures };

async function signWithdraw(amount, recipient, deadline) {
  const nonce = await pub.readContract({ address: M.borrowerOpsSignatures, abi: mezoAbi, functionName: "getNonce", args: [W.homeowner.address] });
  return W.homeowner.client.signTypedData({
    domain: bosDomain,
    types: { WithdrawMUSD: [{ name: "amount", type: "uint256" }, { name: "borrower", type: "address" }, { name: "recipient", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "WithdrawMUSD",
    message: { amount, borrower: W.homeowner.address, recipient, nonce, deadline },
  });
}

async function signRepay(amount, deadline) {
  const nonce = await pub.readContract({ address: M.borrowerOpsSignatures, abi: mezoAbi, functionName: "getNonce", args: [W.homeowner.address] });
  return W.homeowner.client.signTypedData({
    domain: bosDomain,
    types: { RepayMUSD: [{ name: "amount", type: "uint256" }, { name: "borrower", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "RepayMUSD",
    message: { amount, borrower: W.homeowner.address, nonce, deadline },
  });
}

async function permit(w, spender, value, deadline) {
  const nonce = await pub.readContract({ address: M.musd, abi: mezoAbi, functionName: "nonces", args: [w.address] });
  const sig = await w.client.signTypedData({
    domain: { name: "Mezo USD", version: "1", chainId: 31611, verifyingContract: M.musd },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: w.address, spender, value, nonce, deadline },
  });
  return { r: `0x${sig.slice(2, 66)}`, s: `0x${sig.slice(66, 130)}`, v: parseInt(sig.slice(130, 132), 16) };
}

const E = (address) => ({ address, abi: escrowAbi });

async function createProject(title, uri, reviewWindow, retentionBps, warranty, guard, stages) {
  const t = await nowS();
  const r = await tx(`Create build fund “${title}”`, W.homeowner, {
    address: deployment.factory,
    abi: factoryAbi,
    functionName: "createProject",
    args: [
      { homeowner: W.homeowner.address, contractor: W.contractor.address, inspector: W.inspector.address, arbiter: W.arbiter.address },
      { reviewWindow, retentionBps, warrantyPeriod: warranty, minIcrAfterDraw: guard, title, metadataURI: uri },
      stages.map(([name, amount, days]) => ({ name, amount: parseUnits(String(amount), 18), deadline: BigInt(t + days * 86400) })),
    ],
  });
  for (const l of r.logs) {
    try {
      const ev = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "ProjectCreated") return ev.args.escrow;
    } catch {}
  }
  throw new Error("ProjectCreated not found");
}

async function stageApproved(esc, i, name) {
  await tx(`Contractor reports stage ${i + 1} “${name}” done`, W.contractor, { ...E(esc), functionName: "requestRelease", args: [BigInt(i), note(`veridom.space/checkpoint/${esc}/${i}`)] });
  await tx(`Homeowner approves stage ${i + 1}`, W.homeowner, { ...E(esc), functionName: "approve", args: [BigInt(i)] });
  await tx(`Inspector passes stage ${i + 1} on site`, W.inspector, { ...E(esc), functionName: "inspect", args: [BigInt(i), true, note(`inspection report ${i}`)] });
}

async function finishA(A, plan) {
  for (const i of [3, 4, 5]) {
    await stageApproved(A, i, plan[i][0]);
    await tx(`Contractor claims stage ${i + 1} in MUSD`, W.contractor, { ...E(A), functionName: "claim", args: [BigInt(i), 0, 0n] });
  }
  await tx("Homeowner flags a warranty defect on the retention", W.homeowner, { ...E(A), functionName: "disputeRetention", args: [note("damp basement wall")] });
  await tx("Arbiter releases 10 MUSD of retention to contractor", W.arbiter, { ...E(A), functionName: "resolveRetention", args: [parseUnits("10", 18)] });
  const free = await pub.readContract({ ...E(A), functionName: "freeBalance" });
  const d2 = BigInt((await nowS()) + 3600);
  const rsig = await signRepay(free, d2);
  const [u2, l2] = await hints(W.homeowner.address, -free);
  await tx(`Unused ${fmt(free)} MUSD repays the homeowner’s trove (RepayMUSD sig)`, W.homeowner, { ...E(A), functionName: "repayTroveFromFree", args: [free, u2, l2, d2, rsig] });
  const h = await pub.readContract({ address: deployment.lens, abi: lensAbi, functionName: "troveHealth", args: [W.homeowner.address] });
  console.log(`  trove after repay: debt ${fmt(h.debt)} MUSD, ICR ${fmt(h.icr * 100n)}%`);
}

async function main() {
  const chainId = await pub.getChainId();
  if (chainId !== 31611) throw new Error(`wrong chain ${chainId}`);
  if (LOCAL) for (const n of ["deployer", "homeowner", "contractor", "inspector"]) await pub.request({ method: "anvil_setBalance", params: [W[n].address, "0x56BC75E2D63100000"] });

  console.log(`Veridom Build Fund — on-chain demo on ${LOCAL ? "LOCAL FORK" : "Mezo testnet"} (factory ${deployment.factory})`);
  const price = await pub.readContract({ address: M.priceFeed, abi: mezoAbi, functionName: "fetchPrice" });
  const dep = await pub.getBalance({ address: W.deployer.address });
  console.log(`BTC price ${fmt(price, 0)} USD · deployer ${fmt(dep, 6)} BTC`);

  // ---------- 1. wallets + homeowner trove ----------
  const status = await pub.readContract({ address: M.troveManager, abi: mezoAbi, functionName: "getTroveStatus", args: [W.homeowner.address] });
  const gas = parseUnits("0.0002", 18);
  for (const n of ["contractor", "inspector"]) {
    if ((await pub.getBalance({ address: W[n].address })) < gas / 2n) await sendBtc(`Gas for ${n}`, W.deployer, W[n].address, gas);
  }
  if (status !== 1) {
    // collateral: everything the deployer can spare, but at least enough for ~200 % on 3,000 MUSD
    const spare = (await pub.getBalance({ address: W.deployer.address })) - parseUnits("0.0005", 18);
    const cap = parseUnits("0.25", 18);
    const coll = spare > cap ? cap : spare;
    const minColl = (2_160n * 10n ** 18n * 145n * 10n ** 16n) / price; // 145 % on ~2.16k debt after the first draw
    if (coll < minColl) throw new Error(`Not enough testnet BTC: have ${fmt(coll, 5)}, need ≈ ${fmt(minColl, 5)} BTC. Request more from the faucet.`);
    await sendBtc(`Fund homeowner with ${fmt(coll, 5)} BTC (collateral + gas)`, W.deployer, W.homeowner.address, coll);
    const debt = parseUnits("1800", 18);
    const fee = await pub.readContract({ address: M.borrowerOperations, abi: mezoAbi, functionName: "getBorrowingFee", args: [debt] });
    const lockColl = coll - parseUnits("0.0005", 18);
    const nicr = (lockColl * 10n ** 20n) / (debt + fee + parseUnits("200", 18));
    const [approx] = await pub.readContract({ address: M.hintHelpers, abi: mezoAbi, functionName: "getApproxHint", args: [nicr, 15n, 42n] });
    const [up, lo] = await pub.readContract({ address: M.sortedTroves, abi: mezoAbi, functionName: "findInsertPosition", args: [nicr, approx, approx] });
    await tx(`Homeowner opens Mezo trove: ${fmt(lockColl, 4)} BTC → 1,800 MUSD`, W.homeowner, { address: M.borrowerOperations, abi: mezoAbi, functionName: "openTrove", args: [debt, up, lo], value: lockColl });
  }
  const health = async () => pub.readContract({ address: deployment.lens, abi: lensAbi, functionName: "troveHealth", args: [W.homeowner.address] });
  let h = await health();
  console.log(`  trove: ${fmt(h.coll, 4)} BTC, debt ${fmt(h.debt)} MUSD, ICR ${fmt(h.icr * 100n)}%, liquidation at ${fmt(h.liquidationPrice, 0)} USD`);

  // ---------- 2. Project A: full lifecycle ----------
  if (ONLY === "all" || ONLY === "A") {
    console.log("\nProject A — complete lifecycle (BTVG Ratenplan B, 1,000 MUSD)");
    const plan = [["Start of works", 100, 30], ["Shell & roof", 300, 90], ["Rough-in installations", 200, 150], ["Facade & windows", 120, 210], ["Ready to move in", 170, 270], ["Completion", 110, 330]];
    const A = await createProject("Demo house A · full lifecycle (testnet)", "https://veridom.space", 90, 200, 120, parseUnits("1.4", 18), plan);
    log.projects.A = A;
    save();
    await tx("Contractor accepts the payment plan", W.contractor, { ...E(A), functionName: "acceptProject" });

    const d1 = BigInt((await nowS()) + 3600);
    const p1 = await permit(W.homeowner, A, parseUnits("850", 18), d1);
    await tx("Homeowner funds 850 MUSD (EIP-2612 permit, 1 tx)", W.homeowner, { ...E(A), functionName: "fundWithPermit", args: [parseUnits("850", 18), d1, p1.v, p1.r, p1.s] });

    const draw = parseUnits("150", 18);
    const sig = await signWithdraw(draw, A, d1);
    const [u1, l1] = await hints(W.homeowner.address, draw);
    await tx("Relayer submits homeowner-signed trove draw: 150 MUSD → escrow", W.relayer, { ...E(A), functionName: "drawFromTrove", args: [draw, u1, l1, d1, sig] });
    h = await health();
    console.log(`  trove after draw: debt ${fmt(h.debt)} MUSD, ICR ${fmt(h.icr * 100n)}% (guard 140 %)`);

    await tx("Harvest: poke PCV distribution, pay sMUSD yield to homeowner", W.relayer, { ...E(A), functionName: "harvest" });

    // stage 1: both sign-offs, MUSD payout
    await stageApproved(A, 0, plan[0][0]);
    await tx("Contractor claims stage 1 in MUSD", W.contractor, { ...E(A), functionName: "claim", args: [0n, 0, 0n] });

    // stage 2: inspector ok, homeowner silent → deemed accepted, BTC payout via Mezo pool
    await tx("Contractor reports stage 2 “Shell & roof” done", W.contractor, { ...E(A), functionName: "requestRelease", args: [1n, note(`veridom.space/checkpoint/${A}/1`)] });
    await tx("Inspector passes stage 2 (homeowner stays silent)", W.inspector, { ...E(A), functionName: "inspect", args: [1n, true, note("inspection report 1")] });
    await waitSeconds(95);
    const net2 = parseUnits("294", 18);
    if (LOCAL) {
      await tx("Contractor claims stage 2 (deemed accepted) in MUSD [fork: BTC precompile n/a]", W.contractor, { ...E(A), functionName: "claim", args: [1n, 0, 0n] });
    } else {
      const amounts = await pub.readContract({ address: M.router, abi: mezoAbi, functionName: "getAmountsOut", args: [net2, [{ from: M.musd, to: M.btc, stable: false, factory: M.poolFactory }]] });
      const minOut = (amounts[1] * 99n) / 100n;
      await tx(`Contractor claims stage 2 in BTC via Mezo pool (min ${fmt(minOut, 6)} BTC)`, W.contractor, { ...E(A), functionName: "claim", args: [1n, 1, minOut] });
    }

    // stage 3: defects → re-request → dispute → arbiter awards 90 %
    await tx("Contractor reports stage 3 done", W.contractor, { ...E(A), functionName: "requestRelease", args: [2n, note(`veridom.space/checkpoint/${A}/2`)] });
    await tx("Homeowner reports defects (missing sockets)", W.homeowner, { ...E(A), functionName: "reject", args: [2n, note("missing sockets in kitchen")] });
    await tx("Contractor re-requests after fix", W.contractor, { ...E(A), functionName: "requestRelease", args: [2n, note(`veridom.space/checkpoint/${A}/2b`)] });
    await tx("Contractor opens dispute (homeowner unresponsive)", W.contractor, { ...E(A), functionName: "dispute", args: [2n, note("owner unresponsive")] });
    await tx("Arbiter awards 180 of 200 MUSD", W.arbiter, { ...E(A), functionName: "resolveDispute", args: [2n, parseUnits("180", 18)] });
    await finishA(A, plan);
  }
  if (ONLY === "A2") {
    const plan = [["Start of works", 100, 30], ["Shell & roof", 300, 90], ["Rough-in installations", 200, 150], ["Facade & windows", 120, 210], ["Ready to move in", 170, 270], ["Completion", 110, 330]];
    await finishA(log.projects.A, plan);
  }
  if (false) {
    const A = null, plan = [];
    for (const i of [3, 4, 5]) {
      await stageApproved(A, i, plan[i][0]);
      await tx(`Contractor claims stage ${i + 1} in MUSD`, W.contractor, { ...E(A), functionName: "claim", args: [BigInt(i), 0, 0n] });
    }

    // warranty: homeowner flags defect, arbiter splits retention
    await tx("Homeowner flags a warranty defect on the retention", W.homeowner, { ...E(A), functionName: "disputeRetention", args: [note("damp basement wall")] });
    await tx("Arbiter releases 10 MUSD of retention to contractor", W.arbiter, { ...E(A), functionName: "resolveRetention", args: [parseUnits("10", 18)] });

    // close-out: free money pays down the trove
    const free = await pub.readContract({ ...E(A), functionName: "freeBalance" });
    const d2 = BigInt((await nowS()) + 3600);
    const rsig = await signRepay(free, d2);
    const [u2, l2] = await hints(W.homeowner.address, -free);
    await tx(`Unused ${fmt(free)} MUSD repays the homeowner’s trove (RepayMUSD sig)`, W.homeowner, { ...E(A), functionName: "repayTroveFromFree", args: [free, u2, l2, d2, rsig] });
    h = await health();
    console.log(`  trove after repay: debt ${fmt(h.debt)} MUSD, ICR ${fmt(h.icr * 100n)}%`);
  }

  // ---------- 3. Project B: live, in progress ----------
  if (ONLY === "all" || ONLY === "B" || ONLY === "A2") {
    console.log("\nProject B — live project left mid-construction for the web app");
    const planB = [["Foundation slab", 90, 45], ["Walls", 150, 120], ["Roof", 120, 180], ["Rough-in", 120, 240], ["Finish", 120, 300]];
    const B = await createProject("Family home, Waldviertel (testnet demo)", "https://veridom.space", 7 * 86400, 500, 365 * 86400, parseUnits("1.5", 18), planB);
    log.projects.B = B;
    save();
    await tx("Contractor accepts the payment plan", W.contractor, { ...E(B), functionName: "acceptProject" });
    const bal = await pub.readContract({ address: M.musd, abi: mezoAbi, functionName: "balanceOf", args: [W.homeowner.address] });
    const fundAmt = bal >= parseUnits("600", 18) ? parseUnits("600", 18) : bal;
    const d3 = BigInt((await nowS()) + 3600);
    const p3 = await permit(W.homeowner, B, fundAmt, d3);
    await tx(`Homeowner funds ${fmt(fundAmt)} MUSD`, W.homeowner, { ...E(B), functionName: "fundWithPermit", args: [fundAmt, d3, p3.v, p3.r, p3.s] });
    await stageApproved(B, 0, planB[0][0]);
    await tx("Contractor claims stage 1 in MUSD", W.contractor, { ...E(B), functionName: "claim", args: [0n, 0, 0n] });
    await tx("Contractor reports stage 2 “Walls” done", W.contractor, { ...E(B), functionName: "requestRelease", args: [1n, note(`veridom.space/checkpoint/${B}/1`)] });
    await tx("Inspector passes stage 2", W.inspector, { ...E(B), functionName: "inspect", args: [1n, true, note("inspection report B1")] });
  }

  // ---------- 4. publish to the web app ----------
  const webDeployment = join(ROOT, "web/src/deployment.json");
  const wd = JSON.parse(readFileSync(webDeployment, "utf8"));
  if (!LOCAL) {
    wd.factory = deployment.factory;
    wd.lens = deployment.lens;
    wd.escrowImplementation = deployment.escrowImplementation;
    wd.deployedAtBlock = deployment.deployedAtBlock;
    wd.demoProject = log.projects.B ?? log.projects.A ?? null;
    wd.showcaseProjects = Object.entries(log.projects).map(([k, a]) => ({ address: a, label: k === "A" ? "Complete lifecycle" : "In progress" }));
    wd.transactions = log.txs.map(({ label, hash }) => ({ label, hash }));
    writeFileSync(webDeployment, JSON.stringify(wd, null, 2) + "\n");
  }
  console.log(`\nDone. ${log.txs.length} transactions recorded in ${runFile}`);
}

main().catch((e) => {
  console.error("\nFAILED:", e.shortMessage ?? e.message);
  process.exit(1);
});
