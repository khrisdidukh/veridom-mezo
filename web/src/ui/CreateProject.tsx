import { useMemo, useState } from "react";
import { decodeEventLog, isAddress, parseUnits, type Address } from "viem";
import { deployment } from "../config";
import { musd } from "../lib/format";
import { factoryAbi } from "../lib/project";
import { TEMPLATES } from "../lib/templates";
import { publicClient, send } from "../lib/wallet";
import { useApp } from "../state";
import { Card } from "./common";

type Row = { name: string; share: number; months: number };

export function CreateProject() {
  const { signer, connect, run, busy } = useApp();
  const [tplId, setTplId] = useState(TEMPLATES[0].id);
  const tpl = TEMPLATES.find((t) => t.id === tplId)!;
  const [title, setTitle] = useState("Single-family house");
  const [budget, setBudget] = useState("250000");
  const [contractor, setContractor] = useState("");
  const [inspector, setInspector] = useState("");
  const [arbiter, setArbiter] = useState("");
  const [reviewDays, setReviewDays] = useState("7");
  const [retention, setRetention] = useState(String(tpl.retentionBps / 100));
  const [warrantyDays, setWarrantyDays] = useState(String(tpl.warrantyDays));
  const [guard, setGuard] = useState("160");
  const [uri, setUri] = useState("https://veridom.space");
  const [rows, setRows] = useState<Row[]>(tpl.stages.map((s, i) => ({ ...s, months: (i + 1) * 2 })));

  const pickTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    setTplId(id);
    setRetention(String(t.retentionBps / 100));
    setWarrantyDays(String(t.warrantyDays));
    setRows(t.stages.map((s, i) => ({ ...s, months: (i + 1) * 2 })));
  };

  const totalShare = rows.reduce((a, r) => a + (Number(r.share) || 0), 0);
  const budgetWei = useMemo(() => {
    try {
      return parseUnits(budget || "0", 18);
    } catch {
      return 0n;
    }
  }, [budget]);
  const amounts = rows.map((r, i) => {
    if (i < rows.length - 1) return (budgetWei * BigInt(Math.round(r.share * 100))) / 10000n;
    return 0n;
  });
  amounts[rows.length - 1] = budgetWei - amounts.slice(0, -1).reduce((a, b) => a + b, 0n);

  const errors: string[] = [];
  if (!isAddress(contractor)) errors.push("Contractor address is required.");
  if (inspector && !isAddress(inspector)) errors.push("Inspector address is invalid.");
  if (!isAddress(arbiter)) errors.push("Arbiter address is required (a mediator both sides trust).");
  if (Math.abs(totalShare - 100) > 0.01) errors.push(`Shares add up to ${totalShare.toFixed(1)}%, not 100%.`);
  if (!deployment.factory) errors.push("Factory not deployed yet.");

  const create = () =>
    run("Create build fund", async (s) => {
      const nowS = Math.floor(Date.now() / 1000);
      const stages = rows.map((r, i) => ({ name: r.name, amount: amounts[i], deadline: BigInt(nowS + Math.round(r.months * 30.4 * 86400)) }));
      const roles = {
        homeowner: s.address,
        contractor: contractor as Address,
        inspector: (inspector || "0x0000000000000000000000000000000000000000") as Address,
        arbiter: arbiter as Address,
      };
      const terms = {
        reviewWindow: Math.round(Number(reviewDays) * 86400),
        retentionBps: Math.round(Number(retention) * 100),
        warrantyPeriod: Math.round(Number(warrantyDays) * 86400),
        minIcrAfterDraw: guard ? parseUnits(String(Number(guard) / 100), 18) : 0n,
        title,
        metadataURI: uri,
      };
      const hash = await send(s, { address: deployment.factory!, abi: factoryAbi, functionName: "createProject", args: [roles, terms, stages] });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: { escrow: Address } };
          if (ev.eventName === "ProjectCreated") location.hash = `#/p/${ev.args.escrow}`;
        } catch {
          /* other logs */
        }
      }
      return hash;
    });

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div>
        <div className="eyebrow">New build fund</div>
        <h2 style={{ fontFamily: "var(--serif)", fontWeight: 400, fontSize: 34 }}>Put your contractor’s payment plan on rails</h2>
        <p className="muted" style={{ maxWidth: 680 }}>
          You create the escrow as the homeowner; the contractor accepts it on-chain. Templates follow common instalment plans and are only a starting point — agree the final plan
          with your contractor.
        </p>
      </div>
      <div className="grid main-side">
        <Card title="Payment plan" sub={tpl.note}>
          <div className="grid cols-2" style={{ marginBottom: 12 }}>
            <label className="field">Template
              <select value={tplId} onChange={(e) => pickTemplate(e.target.value)}>
                {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label className="field">Total budget (MUSD)<input className="mono" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          </div>
          <table className="plan">
            <thead><tr><th>#</th><th>Stage</th><th>Share %</th><th>Due in (months)</th><th style={{ textAlign: "right" }}>MUSD</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono muted">{i + 1}</td>
                  <td><input value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                  <td style={{ width: 90 }}><input className="mono" value={r.share} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))} /></td>
                  <td style={{ width: 110 }}><input className="mono" value={r.months} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, months: Number(e.target.value) } : x)))} /></td>
                  <td className="mono" style={{ textAlign: "right" }}>{musd(amounts[i], 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 8 }}>Total {totalShare.toFixed(1)}% · {retention}% of every payment is held back as retention until {warrantyDays} days after completion.</div>
        </Card>
        <div className="grid">
          <Card title="People & rules">
            <div className="grid" style={{ gap: 10 }}>
              <label className="field">Project title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="field">Contractor wallet<input className="mono" placeholder="0x…" value={contractor} onChange={(e) => setContractor(e.target.value)} /></label>
              <label className="field">Independent inspector (optional)<input className="mono" placeholder="0x… (e.g. Ziviltechniker)" value={inspector} onChange={(e) => setInspector(e.target.value)} /></label>
              <label className="field">Arbiter for disputes<input className="mono" placeholder="0x… (mediator both sides accept)" value={arbiter} onChange={(e) => setArbiter(e.target.value)} /></label>
              <div className="grid cols-2" style={{ gap: 10 }}>
                <label className="field">Review window (days)<input className="mono" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} /></label>
                <label className="field">Retention (%)<input className="mono" value={retention} onChange={(e) => setRetention(e.target.value)} /></label>
                <label className="field">Warranty (days)<input className="mono" value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value)} /></label>
                <label className="field">BTC loan guard (%)<input className="mono" value={guard} onChange={(e) => setGuard(e.target.value)} /></label>
              </div>
              <label className="field">Veridom project link<input value={uri} onChange={(e) => setUri(e.target.value)} /></label>
            </div>
          </Card>
          {errors.length > 0 && <div className="callout warn">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
          {signer ? (
            <button className="btn" disabled={!!busy || errors.length > 0} onClick={create}>Create build fund on Mezo</button>
          ) : (
            <button className="btn" onClick={connect}>Connect wallet as homeowner</button>
          )}
        </div>
      </div>
    </div>
  );
}
