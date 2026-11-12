import { useEffect, useMemo, useState } from "react";
import { keccak256, parseUnits, toBytes, type Address } from "viem";
import { MEZO, addressUrl, txUrl } from "../config";
import { btc, date, duration, musd, pct, relative, short, usd } from "../lib/format";
import { deadlineIn, adjustHints, musdBalance, quoteMusdToBtc, signMusdPermit, signRepayMUSD, signWithdrawMUSD } from "../lib/mezo";
import {
  escrowAbi,
  loadActivity,
  loadProject,
  loadTroveHealth,
  previewDraw,
  type Project,
  type Stage,
  type TroveHealth,
} from "../lib/project";
import { send, type Signer } from "../lib/wallet";
import { useApp, usePoll } from "../state";
import { Addr, AmountInput, Card, NoteAction } from "./common";
import { OpenTrove } from "./Borrow";

type Role = "homeowner" | "contractor" | "inspector" | "arbiter" | "viewer";

const hashNote = (s: string) => keccak256(toBytes(s));
const now = () => Math.floor(Date.now() / 1000);

function roleOf(p: Project, a?: Address): Role {
  if (!a) return "viewer";
  const x = a.toLowerCase();
  if (x === p.homeowner.toLowerCase()) return "homeowner";
  if (x === p.contractor.toLowerCase()) return "contractor";
  if (x === p.inspector.toLowerCase()) return "inspector";
  if (x === p.arbiter.toLowerCase()) return "arbiter";
  return "viewer";
}

const hasInspector = (p: Project) => !/^0x0{40}$/.test(p.inspector);

export function ProjectView({ address }: { address: Address }) {
  const { signer } = useApp();
  const { data: p, error } = usePoll(() => loadProject(address), [address], 6000);
  const homeowner = p?.homeowner;
  const { data: trove } = usePoll(() => (homeowner ? loadTroveHealth(homeowner) : Promise.resolve(null)), [homeowner], 10000);

  if (error && !p) return <div className="card">Could not load this project: {error}</div>;
  if (!p) return <div className="card muted">Loading project from Mezo testnet…</div>;
  const role = roleOf(p, signer?.address);

  return (
    <div className="grid" style={{ gap: 18 }}>
      <Header p={p} role={role} />
      <NextStep p={p} role={role} />
      <div className="grid main-side">
        <div className="grid">
          <Money p={p} />
          <StageList p={p} role={role} />
          <Activity address={address} />
        </div>
        <div className="grid">
          <FundCard p={p} role={role} trove={trove} />
          <TroveCard p={p} trove={trove} />
          <YieldCard p={p} />
          <Closeout p={p} role={role} />
        </div>
      </div>
    </div>
  );
}

function Header({ p, role }: { p: Project; role: Role }) {
  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow">Veridom Build Fund · Mezo testnet</div>
          <h2 style={{ fontFamily: "var(--serif)", fontWeight: 400, fontSize: 32, marginTop: 4 }}>{p.title}</h2>
          <div className="small muted" style={{ marginTop: 4 }}>
            Escrow <Addr a={p.address} /> {" · "} review window {duration(p.reviewWindow)} · retention {p.retentionBps / 100}% for{" "}
            {duration(p.warrantyPeriod)}
            {p.metadataURI && (
              <>
                {" · "}
                <a href={p.metadataURI} target="_blank" rel="noreferrer">
                  project record
                </a>
              </>
            )}
          </div>
        </div>
        <div className="btn-row">
          {p.completedAt > 0 ? <span className="chip ok">Completed {date(p.completedAt)}</span> : <span className="chip warn">Under construction</span>}
          {p.contractorAccepted ? <span className="chip ok">Plan signed by contractor</span> : <span className="chip">Waiting for contractor</span>}
          {role !== "viewer" && <span className="chip you">You are the {role}</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }} className="small">
        <span>Homeowner <Addr a={p.homeowner} /></span>
        <span>Contractor <Addr a={p.contractor} /></span>
        <span>Inspector <Addr a={p.inspector} /></span>
        <span>Arbiter <Addr a={p.arbiter} /></span>
      </div>
    </div>
  );
}

function nextStepText(p: Project, role: Role): { tag: string; text: string } | null {
  const t = now();
  const requested = p.stages.find((s) => s.status === "Requested");
  const claimable = p.stages.find((s) => s.claimable);
  const disputed = p.stages.find((s) => s.status === "Disputed");
  const open = p.stages.find((s) => s.status === "Pending" || s.status === "Rejected");
  if (role === "contractor") {
    if (!p.contractorAccepted) return { tag: "Your next step", text: "Review the payment plan below and accept it on-chain. Every stage is pre-funded and protected by the escrow." };
    if (claimable) return { tag: "Payment ready", text: `“${claimable.name}” is approved. Claim ${musd(claimable.amount * BigInt(10000 - p.retentionBps) / 10000n)} MUSD — or take it in BTC.` };
    if (requested) return { tag: "Waiting", text: `“${requested.name}” is under review. If the homeowner stays silent it is accepted ${relative(requested.requestedAt + p.reviewWindow)}${hasInspector(p) && !requested.inspectorApproved ? " (after the inspector’s visit)" : ""}.` };
    if (open) return { tag: "Your next step", text: `When “${open.name}” is finished, report it with your Veridom checkpoint (photos + sign-off). Deadline ${date(open.deadline)}.` };
  }
  if (role === "homeowner") {
    if (requested && !requested.homeownerApproved)
      return { tag: "Please review", text: `The contractor reported “${requested.name}” as done. Approve, report defects or dispute ${relative(requested.requestedAt + p.reviewWindow)} — after that silence counts as acceptance.` };
    if (p.shortfall > 0n) return { tag: "Your next step", text: `Your build fund is ${musd(p.shortfall)} MUSD short of the plan. Add MUSD, or borrow it against your BTC without selling it.` };
    if (p.freeBalance > 0n) return { tag: "Unused money", text: `${musd(p.freeBalance)} MUSD is not needed for any stage. Withdraw it or pay down your Mezo loan.` };
    if (p.completedAt > 0 && p.retentionHeld > 0n) return { tag: "Warranty", text: `${musd(p.retentionHeld)} MUSD retention is held until ${date(p.completedAt + p.warrantyPeriod)}. Flag defects before then if needed.` };
  }
  if (role === "inspector" && requested && !requested.inspectorApproved)
    return { tag: "Site visit", text: `Inspect “${requested.name}” and record the result. Payment cannot be released without your sign-off.` };
  if (role === "arbiter" && disputed) return { tag: "Decision needed", text: `“${disputed.name}” is disputed. Decide how much of ${musd(disputed.amount)} MUSD the contractor receives.` };
  if (role === "viewer")
    return { tag: "Live testnet project", text: "Everything on this page is read from Mezo testnet. Connect a wallet that holds one of the roles to act." };
  void t;
  return null;
}

function NextStep({ p, role }: { p: Project; role: Role }) {
  const n = nextStepText(p, role);
  if (!n) return null;
  return (
    <div className="next">
      <div>
        <div className="tag">{n.tag}</div>
        <b>{n.text}</b>
      </div>
    </div>
  );
}

function Money({ p }: { p: Project }) {
  const total = p.budget > 0n ? p.budget : 1n;
  const w = (v: bigint) => `${Math.min(100, Number((v * 10000n) / total) / 100)}%`;
  const paidGross = p.totalPaidToContractor;
  const securedOpen = p.principal > p.retentionHeld ? p.principal - p.retentionHeld - p.freeBalance : 0n;
  return (
    <Card title="Construction budget" sub="Every MUSD is either paid out, waiting in the Savings Rate vault for its stage, or still missing.">
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="stat"><span className="l">Plan</span><span className="v">{musd(p.budget, 0)}</span><span className="tiny muted">MUSD in {p.stages.length} stages</span></div>
        <div className="stat"><span className="l">Paid to contractor</span><span className="v">{musd(paidGross, 0)}</span><span className="tiny muted">+ {musd(p.retentionHeld, 0)} retention held</span></div>
        <div className="stat"><span className="l">Secured for open stages</span><span className="v">{musd(securedOpen, 0)}</span><span className="tiny muted">{p.shortfall > 0n ? `${musd(p.shortfall, 0)} still missing` : "fully funded"}</span></div>
      </div>
      <div className="bar" aria-label="budget bar">
        <span style={{ width: w(paidGross), background: "var(--ok)" }} />
        <span style={{ width: w(p.retentionHeld), background: "#7fb89a" }} />
        <span style={{ width: w(securedOpen), background: "var(--blue)" }} />
        <span style={{ width: w(p.shortfall), background: "repeating-linear-gradient(45deg,#e8c9a0 0 6px,#f6e6cf 6px 12px)" }} />
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--ok)" }} />paid</span>
        <span><i style={{ background: "#7fb89a" }} />retention</span>
        <span><i style={{ background: "var(--blue)" }} />in escrow, earning yield</span>
        <span><i style={{ background: "#e8c9a0" }} />not funded yet</span>
        {p.freeBalance > 0n && <span>· {musd(p.freeBalance)} MUSD free</span>}
      </div>
      <div className="hr" />
      <div className="small muted">
        Funded {musd(p.totalFunded)} MUSD total, of which {musd(p.totalDrawnFromTrove)} borrowed straight from the homeowner’s BTC trove · {musd(p.totalYieldPaid, 4)} MUSD
        savings yield paid out · {musd(p.totalRepaidToTrove)} MUSD returned to the loan.
      </div>
    </Card>
  );
}

function StageList({ p, role }: { p: Project; role: Role }) {
  const current = p.stages.find((s) => !["Paid", "Cancelled"].includes(s.status));
  // Open stages are covered in plan order by the spendable escrow balance (retention excluded).
  const spendable = p.principal - p.retentionHeld;
  let cumulative = 0n;
  return (
    <Card title="Payment plan" sub="Money moves only when the rules below are met — enforced by the escrow contract, not by Veridom.">
      <div className="stages">
        {p.stages.map((s) => {
          const open = !["Paid", "Cancelled"].includes(s.status);
          if (open) cumulative += s.amount;
          const secured = !open || spendable >= cumulative;
          return <StageRow key={s.id} p={p} s={s} role={role} current={current?.id === s.id} secured={secured} />;
        })}
      </div>
    </Card>
  );
}

function StageRow({ p, s, role, current, secured }: { p: Project; s: Stage; role: Role; current: boolean; secured: boolean }) {
  const { run, busy } = useApp();
  const [btcQuote, setBtcQuote] = useState<bigint | null>(null);
  const [award, setAward] = useState("");
  const net = (s.amount * BigInt(10000 - p.retentionBps)) / 10000n;
  const t = now();
  const windowEnd = s.requestedAt + p.reviewWindow;
  const inWindow = s.status === "Requested" && t < windowEnd;

  useEffect(() => {
    if (role === "contractor" && s.claimable) quoteMusdToBtc(net).then(setBtcQuote).catch(() => setBtcQuote(null));
  }, [role, s.claimable, net]);

  const w = (fn: string, args: unknown[]) => (signer: Signer) => send(signer, { address: p.address, abi: escrowAbi, functionName: fn, args });
  const share = p.budget > 0n ? Number((s.amount * 1000n) / p.budget) / 10 : 0;

  return (
    <div className={`stage ${s.status} ${current ? "current" : ""}`}>
      <div className="num">{s.status === "Paid" ? "✓" : s.id + 1}</div>
      <div>
        <div className="title">
          {s.name} <span className={`chip ${s.status}`}>{s.status === "Approved" ? "Approved · ready to pay" : s.status}</span>
          {s.claimable && s.status === "Requested" && <span className="chip ok">accepted by silence</span>}
          {!["Paid", "Cancelled"].includes(s.status) && (secured ? <span className="chip ok">funded</span> : <span className="chip warn">not funded yet</span>)}
        </div>
        <div className="meta">
          <span>{share}% of plan</span>
          <span>deadline {date(s.deadline)}</span>
          {s.status === "Requested" && <span>review {t < windowEnd ? `ends ${relative(windowEnd)}` : "window over"}</span>}
          {s.evidenceHash !== `0x${"0".repeat(64)}` && <span className="mono" title={s.evidenceHash}>evidence {short(s.evidenceHash)}</span>}
          {s.status === "Paid" && <span>paid {musd(s.paidToContractor)} net</span>}
        </div>
        {(s.status === "Requested" || s.status === "Approved") && (
          <div className="signoffs" style={{ marginTop: 6 }}>
            <span className={`sign ${s.homeownerApproved ? "yes" : ""}`}>{s.homeownerApproved ? "✓" : "○"} homeowner</span>
            {hasInspector(p) && <span className={`sign ${s.inspectorApproved ? "yes" : ""}`}>{s.inspectorApproved ? "✓" : "○"} inspector</span>}
          </div>
        )}
      </div>
      <div className="amount">
        {musd(s.amount, 0)} <span className="muted small">MUSD</span>
      </div>
      <div className="actions">
        {role === "contractor" && (s.status === "Pending" || s.status === "Rejected") && p.contractorAccepted && (
          <NoteAction
            label={s.status === "Rejected" ? "Report fixed" : "Report stage done"}
            className="btn sm blue"
            placeholder="Veridom checkpoint link or ID"
            onConfirm={(note) => run(`Report “${s.name}” done`, w("requestRelease", [BigInt(s.id), hashNote(note)]))}
          />
        )}
        {role === "contractor" && s.claimable && (
          <>
            <button className="btn sm ok" disabled={!!busy} onClick={() => run(`Claim ${musd(net)} MUSD`, w("claim", [BigInt(s.id), 0, 0n]))}>
              Claim {musd(net)} MUSD
            </button>
            <button
              className="btn sm btc"
              disabled={!!busy || !btcQuote}
              title="Swapped through the Mezo MUSD/BTC pool, max 1% slippage"
              onClick={() => run(`Claim in BTC`, w("claim", [BigInt(s.id), 1, ((btcQuote ?? 0n) * 99n) / 100n]))}
            >
              Take it in BTC {btcQuote ? `(≈ ${btc(btcQuote)} BTC)` : ""}
            </button>
          </>
        )}
        {role === "homeowner" && s.status === "Requested" && !s.homeownerApproved && (
          <>
            <button className="btn sm ok" disabled={!!busy} onClick={() => run(`Approve “${s.name}”`, w("approve", [BigInt(s.id)]))}>
              Approve stage
            </button>
            {inWindow && (
              <NoteAction label="Report defects" placeholder="What needs fixing?" onConfirm={(n) => run("Report defects", w("reject", [BigInt(s.id), hashNote(n)]))} />
            )}
          </>
        )}
        {((role === "homeowner" && (inWindow || s.status === "Rejected")) || (role === "contractor" && (s.status === "Requested" || s.status === "Rejected"))) && (
          <NoteAction label="Dispute" className="btn sm bad" placeholder="Reason for the arbiter" onConfirm={(n) => run("Open dispute", w("dispute", [BigInt(s.id), hashNote(n)]))} />
        )}
        {role === "homeowner" && (s.status === "Pending" || s.status === "Rejected") && t > s.deadline && (
          <button className="btn sm bad" disabled={!!busy} onClick={() => run("Cancel overdue stage", w("cancelStage", [BigInt(s.id)]))}>
            Deadline passed — cancel stage & free {musd(s.amount)} MUSD
          </button>
        )}
        {role === "inspector" && s.status === "Requested" && !s.inspectorApproved && (
          <>
            <NoteAction label="Pass inspection" className="btn sm ok" placeholder="Inspection report ID" onConfirm={(n) => run("Inspection passed", w("inspect", [BigInt(s.id), true, hashNote(n)]))} />
            <NoteAction label="Fail inspection" className="btn sm bad" placeholder="Defects found" onConfirm={(n) => run("Inspection failed", w("inspect", [BigInt(s.id), false, hashNote(n)]))} />
          </>
        )}
        {role === "arbiter" && s.status === "Disputed" && (
          <span style={{ display: "inline-flex", gap: 6 }}>
            <div style={{ width: 160 }}><AmountInput value={award} onChange={setAward} max={musd(s.amount, 18).replace(/,/g, "")} /></div>
            <button className="btn sm" disabled={!!busy || !award} onClick={() => run("Resolve dispute", w("resolveDispute", [BigInt(s.id), parseUnits(award || "0", 18)]))}>
              Award to contractor
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function FundCard({ p, role, trove }: { p: Project; role: Role; trove: TroveHealth | null }) {
  const { run, busy, signer } = useApp();
  const [tab, setTab] = useState<"trove" | "wallet">(role === "homeowner" ? "trove" : "wallet");
  const [amount, setAmount] = useState("");
  const [bal, setBal] = useState<bigint | null>(null);
  const [preview, setPreview] = useState<{ icr: bigint; liq: bigint } | null>(null);
  const suggested = p.shortfall > 0n ? musd(p.shortfall, 2).replace(/,/g, "") : "";
  const value = amount || suggested;
  const wei = useMemo(() => {
    try {
      return parseUnits(value || "0", 18);
    } catch {
      return 0n;
    }
  }, [value]);

  useEffect(() => {
    if (signer) musdBalance(signer.address).then(setBal).catch(() => setBal(null));
  }, [signer, p.principal]);
  useEffect(() => {
    if (tab === "trove" && trove?.status === 1 && wei > 0n) previewDraw(p.homeowner, wei).then(setPreview).catch(() => setPreview(null));
    else setPreview(null);
  }, [tab, trove?.status, wei, p.homeowner]);

  if (p.completedAt > 0 && p.shortfall === 0n) return null;
  const guard = p.minIcrAfterDraw;
  const blocked = preview && guard > 0n && preview.icr < guard;

  return (
    <Card title="Fund the build" sub={p.shortfall > 0n ? `${musd(p.shortfall)} MUSD missing to cover the whole plan` : "The plan is fully funded"}>
      <div className="tabs">
        <button className={tab === "trove" ? "on" : ""} onClick={() => setTab("trove")}>Borrow against BTC</button>
        <button className={tab === "wallet" ? "on" : ""} onClick={() => setTab("wallet")}>From wallet</button>
      </div>
      <div className="grid" style={{ gap: 10 }}>
        <AmountInput value={value} onChange={setAmount} />
        {tab === "wallet" && (
          <>
            <div className="tiny muted">Wallet balance: {bal === null ? "—" : `${musd(bal)} MUSD`}. One signature (permit) + one transaction.</div>
            <button
              className="btn"
              disabled={!!busy || wei === 0n}
              onClick={() =>
                run(`Fund ${musd(wei)} MUSD`, async (s) => {
                  const deadline = deadlineIn(3600);
                  const { v, r, s: ss } = await signMusdPermit(s, p.address, wei, deadline);
                  return send(s, { address: p.address, abi: escrowAbi, functionName: "fundWithPermit", args: [wei, deadline, v, r, ss] });
                })
              }
            >
              Add to build fund
            </button>
          </>
        )}
        {tab === "trove" && role !== "homeowner" && <div className="callout info">Only the homeowner can borrow against her own BTC. Connect as the homeowner.</div>}
        {tab === "trove" && role === "homeowner" && trove?.status !== 1 && <OpenTrove compact />}
        {tab === "trove" && role === "homeowner" && trove?.status === 1 && (
          <>
            {preview && (
              <div className={`callout ${blocked ? "bad" : preview.icr < 1.6e18 ? "warn" : "ok"}`}>
                After this draw your loan is {pct(preview.icr)} collateralised. Liquidation only if BTC falls below {usd(preview.liq)} (now {usd(trove.price)}, −
                {Math.max(0, 100 - Number((preview.liq * 100n) / trove.price))}%).
                {blocked && ` Your on-chain guard (${pct(guard)}) will reject this draw.`}
              </div>
            )}
            <button
              className="btn btc"
              disabled={!!busy || wei === 0n || !!blocked}
              onClick={() =>
                run(`Borrow ${musd(wei)} MUSD into escrow`, async (s) => {
                  const deadline = deadlineIn(1800);
                  const sig = await signWithdrawMUSD(s, wei, p.address, deadline);
                  const [upper, lower] = await adjustHints(s.address, wei);
                  return send(s, { address: p.address, abi: escrowAbi, functionName: "drawFromTrove", args: [wei, upper, lower, deadline, sig] });
                })
              }
            >
              Sign & borrow into escrow
            </button>
            <div className="tiny muted">
              You sign one EIP-712 message; Mezo mints the MUSD against your trove straight into this escrow. Draw guard: {guard > 0n ? pct(guard) : "off"}.
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function TroveCard({ p, trove }: { p: Project; trove: TroveHealth | null }) {
  if (!trove) return null;
  const pos = (icr: bigint) => {
    const v = Number(icr) / 1e16; // percent
    return `${Math.max(0, Math.min(100, ((v - 110) / (300 - 110)) * 100))}%`;
  };
  if (trove.status !== 1)
    return (
      <Card title="Homeowner’s BTC loan" sub="Mezo trove">
        <div className="small muted">No open trove for this homeowner. The build is funded from wallet MUSD only.</div>
      </Card>
    );
  const drop = Math.max(0, 100 - Number((trove.liquidationPrice * 100n) / trove.price));
  return (
    <Card title={<>Homeowner’s BTC loan <span className="chip btc">Mezo trove</span></>} sub="Read live from TroveManager + PriceFeed via BuildFundLens">
      <div className="gauge" aria-label="collateral ratio">
        <div className="needle" style={{ left: pos(trove.icr) }} title={`ICR ${pct(trove.icr)}`} />
      </div>
      <div className="gauge-scale"><span>110% liq.</span><span>150%</span><span>200%</span><span>300%+</span></div>
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Collateral ratio</dt><dd>{pct(trove.icr)}</dd>
        <dt>Collateral</dt><dd>{btc(trove.coll)} BTC</dd>
        <dt>Debt</dt><dd>{musd(trove.debt)} MUSD</dd>
        <dt>BTC price (oracle)</dt><dd>{usd(trove.price)}</dd>
        <dt>Liquidation price</dt><dd>{usd(trove.liquidationPrice)}</dd>
        <dt>Fixed interest</dt><dd>{(trove.interestRateBps / 100).toFixed(2)}% / yr</dd>
        <dt>Draw guard</dt><dd>{p.minIcrAfterDraw > 0n ? pct(p.minIcrAfterDraw) : "off"}</dd>
      </dl>
      <div className={`callout ${drop < 25 ? "bad" : drop < 40 ? "warn" : "ok"}`} style={{ marginTop: 12 }}>
        BTC can fall {drop}% before this loan is at risk. {trove.recoveryMode ? "Mezo is in recovery mode." : ""}
      </div>
    </Card>
  );
}

function YieldCard({ p }: { p: Project }) {
  const { run, busy } = useApp();
  return (
    <Card title="Savings yield on waiting money" sub={<>Parked in the MUSD Savings Rate vault (<a href={addressUrl(MEZO.savingsRate)} target="_blank" rel="noreferrer">sMUSD</a>)</>}>
      <dl className="kv">
        <dt>In vault now</dt><dd>{musd(p.principal)} MUSD</dd>
        <dt>Earned, not yet paid</dt><dd>{musd(p.pendingYield, 6)} MUSD</dd>
        <dt>Paid to homeowner</dt><dd>{musd(p.totalYieldPaid, 6)} MUSD</dd>
      </dl>
      <div className="tiny muted" style={{ margin: "8px 0 10px" }}>
        Yield comes from MUSD protocol fees (interest, origination, refinancing) that the PCV distributes to sMUSD holders. Harvest is permissionless and pays the homeowner.
      </div>
      <button className="btn ghost sm" disabled={!!busy} onClick={() => run("Harvest yield", (s) => send(s, { address: p.address, abi: escrowAbi, functionName: "harvest" }))}>
        Harvest yield
      </button>
    </Card>
  );
}

function Closeout({ p, role }: { p: Project; role: Role }) {
  const { run, busy } = useApp();
  const [amt, setAmt] = useState("");
  const [split, setSplit] = useState("");
  const t = now();
  const releaseAt = p.completedAt + p.warrantyPeriod;
  const showFree = p.freeBalance > 0n && role === "homeowner";
  const showRet = p.retentionHeld > 0n;
  if (!showFree && !showRet && !(role === "contractor" && !p.contractorAccepted)) return null;
  const wei = (() => {
    try {
      return parseUnits(amt || musd(p.freeBalance, 18).replace(/,/g, ""), 18);
    } catch {
      return 0n;
    }
  })();
  return (
    <Card title="Contract & close-out">
      <div className="grid" style={{ gap: 12 }}>
        {role === "contractor" && !p.contractorAccepted && (
          <button className="btn blue" disabled={!!busy} onClick={() => run("Accept payment plan", (s) => send(s, { address: p.address, abi: escrowAbi, functionName: "acceptProject" }))}>
            Accept payment plan
          </button>
        )}
        {showFree && (
          <div className="grid" style={{ gap: 8 }}>
            <div className="small"><b>{musd(p.freeBalance)} MUSD</b> is free (over-funding, cancelled stages or dispute remainders).</div>
            <AmountInput value={amt} onChange={setAmt} max={musd(p.freeBalance, 18).replace(/,/g, "")} />
            <div className="btn-row">
              <button
                className="btn btc sm"
                disabled={!!busy || wei === 0n}
                onClick={() =>
                  run(`Repay ${musd(wei)} MUSD of the Mezo loan`, async (s) => {
                    const deadline = deadlineIn(1800);
                    const sig = await signRepayMUSD(s, wei, deadline);
                    const [upper, lower] = await adjustHints(s.address, -wei);
                    return send(s, { address: p.address, abi: escrowAbi, functionName: "repayTroveFromFree", args: [wei, upper, lower, deadline, sig] });
                  })
                }
              >
                Pay down my BTC loan
              </button>
              <button
                className="btn ghost sm"
                disabled={!!busy || wei === 0n}
                onClick={() => run(`Withdraw ${musd(wei)} MUSD`, (s) => send(s, { address: p.address, abi: escrowAbi, functionName: "withdrawFree", args: [wei, s.address] }))}
              >
                Withdraw to wallet
              </button>
            </div>
          </div>
        )}
        {showRet && (
          <div className="grid" style={{ gap: 8 }}>
            <div className="small">
              <b>{musd(p.retentionHeld)} MUSD</b> retention {p.completedAt ? `releasable to the contractor ${relative(releaseAt)}` : "accumulates until handover"}
              {p.retentionDisputed && <span className="chip bad" style={{ marginLeft: 6 }}>disputed</span>}
            </div>
            <div className="btn-row">
              {role === "homeowner" && p.completedAt > 0 && (
                <button className="btn sm ok" disabled={!!busy} onClick={() => run("Release retention", (s) => send(s, { address: p.address, abi: escrowAbi, functionName: "releaseRetention" }))}>
                  Release retention now
                </button>
              )}
              {role === "homeowner" && p.completedAt > 0 && t < releaseAt && !p.retentionDisputed && (
                <NoteAction label="Flag warranty defect" className="btn sm bad" placeholder="Defect description" onConfirm={(n) => run("Flag defect", (s) => send(s, { address: p.address, abi: escrowAbi, functionName: "disputeRetention", args: [hashNote(n)] }))} />
              )}
              {role === "contractor" && p.completedAt > 0 && t >= releaseAt && !p.retentionDisputed && (
                <button className="btn sm ok" disabled={!!busy} onClick={() => run("Release retention", (s) => send(s, { address: p.address, abi: escrowAbi, functionName: "releaseRetention" }))}>
                  Release retention
                </button>
              )}
              {role === "arbiter" && p.retentionDisputed && (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <div style={{ width: 150 }}><AmountInput value={split} onChange={setSplit} /></div>
                  <button className="btn sm" disabled={!!busy || !split} onClick={() => run("Resolve retention", (s) => send(s, { address: p.address, abi: escrowAbi, functionName: "resolveRetention", args: [parseUnits(split, 18)] }))}>
                    To contractor
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

const EVENT_TEXT: Record<string, (a: Record<string, unknown>) => string> = {
  ProjectInitialized: () => "Build fund created",
  ContractorAccepted: () => "Contractor accepted the payment plan",
  Funded: (a) => `${musd(a.amount as bigint)} MUSD added${a.fromTrove ? " — borrowed against BTC" : ""}`,
  StageRequested: (a) => `Stage ${Number(a.stageId) + 1} reported done`,
  StageApprovedByHomeowner: (a) => `Homeowner approved stage ${Number(a.stageId) + 1}`,
  StageInspected: (a) => `Inspector ${a.passed ? "passed" : "failed"} stage ${Number(a.stageId) + 1}`,
  StageRejected: (a) => `Defects reported on stage ${Number(a.stageId) + 1}`,
  StageReady: (a) => `Stage ${Number(a.stageId) + 1} ready to pay`,
  StageDisputed: (a) => `Stage ${Number(a.stageId) + 1} disputed`,
  DisputeResolved: (a) => `Arbiter awarded ${musd(a.toContractor as bigint)} MUSD (stage ${Number(a.stageId) + 1})`,
  StagePaid: (a) =>
    `Stage ${Number(a.stageId) + 1} paid: ${musd(a.net as bigint)} MUSD${Number(a.asset) === 1 ? ` → ${btc(a.amountOut as bigint)} BTC via Mezo pool` : ""}`,
  StageCancelled: (a) => `Stage ${Number(a.stageId) + 1} cancelled after deadline`,
  ProjectCompleted: () => "All stages settled — warranty period started",
  RetentionDisputed: () => "Warranty defect flagged",
  RetentionReleased: (a) => `Retention released: ${musd(a.toContractor as bigint)} MUSD to contractor`,
  FreeWithdrawn: (a) => `${musd(a.amount as bigint)} MUSD withdrawn by homeowner`,
  TroveRepaid: (a) => `${musd(a.amount as bigint)} MUSD repaid to the homeowner’s trove`,
  YieldPaid: (a) => `${musd(a.amount as bigint, 6)} MUSD savings yield paid to homeowner`,
  DrawGuardUpdated: (a) => `Draw guard set to ${pct(a.minIcrAfterDraw as bigint)}`,
};

function Activity({ address }: { address: Address }) {
  const { data } = usePoll(() => loadActivity(address), [address], 20000);
  return (
    <Card title="On-chain activity" sub="Every step is a Mezo testnet transaction">
      {!data && <div className="small muted">Loading events…</div>}
      {data && data.length === 0 && <div className="small muted">No events yet.</div>}
      <ul className="activity">
        {data?.filter((i) => i.event !== "Initialized").slice(0, 30).map((i) => (
          <li key={`${i.tx}-${i.event}-${String(i.args.stageId ?? "")}`}>
            <span>{EVENT_TEXT[i.event]?.(i.args) ?? i.event}</span>
            <a className="mono tiny" href={txUrl(i.tx)} target="_blank" rel="noreferrer">
              {i.time ? relative(i.time) : `#${i.block}`} ↗
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
