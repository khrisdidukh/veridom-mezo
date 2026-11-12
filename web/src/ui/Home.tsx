import { MEZO, addressUrl, deployment, txUrl } from "../config";
import { musd } from "../lib/format";
import { allProjects, loadProject, projectsOf } from "../lib/project";
import { useApp, usePoll } from "../state";
import { Card } from "./common";

export function Home() {
  const demo = deployment.demoProject;
  return (
    <div className="grid" style={{ gap: 28 }}>
      <section className="hero">
        <div>
          <div className="eyebrow">Veridom · Build Fund on Mezo</div>
          <h1>
            Build your house on <em>Bitcoin</em> — without selling it.
          </h1>
          <p className="lead">
            Borrow MUSD against your BTC, lock the construction budget in an escrow that pays your contractor stage by stage, and let the money that is still waiting earn Mezo
            savings yield. No bank in the middle, no trust needed between you and the builder.
          </p>
          <div className="btn-row">
            {demo ? (
              <a className="btn" href={`#/p/${demo}`}>Open the live demo project</a>
            ) : (
              <span className="btn" aria-disabled>Live demo deploying…</span>
            )}
            <a className="btn ghost" href="#/new">Start a build fund</a>
          </div>
          <p className="small muted" style={{ marginTop: 14 }}>
            A module of <a href="https://veridom.space" target="_blank" rel="noreferrer">Veridom</a>, the house-building control app for private homebuilders in Austria and Ukraine.
            Testnet only — no real money.
          </p>
        </div>
        <Card title="Why homeowners need this" sub="The problem">
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
            <li>Builders ask for money up front; owners fear paying for work that is not done. Paying by stage (Ratenplan) is standard — but someone has to hold the money.</li>
            <li>Bitcoin holders sell BTC to fund a build and lose their upside. A Mezo trove lets them borrow against it at a fixed rate instead.</li>
            <li>A build takes a year or more, so most of the budget waits. Here it earns MUSD Savings Rate yield until each stage is paid.</li>
          </ul>
        </Card>
      </section>

      <section className="steps">
        {[
          ["Borrow against BTC", "Open a Mezo trove or use MUSD you hold. An on-chain guard blocks draws that would push your loan below the ratio you chose."],
          ["Lock the plan", "The contractor’s instalment plan becomes an escrow: budget, deadlines, inspector, arbiter, retention."],
          ["Money earns while it waits", "Unreleased MUSD sits in the MUSD Savings Rate vault (sMUSD); yield goes to the homeowner."],
          ["Pay on proof", "A stage pays when the homeowner and the inspector sign off — or automatically if the owner stays silent. The builder can take BTC."],
        ].map(([h, p]) => (
          <div className="card step" key={h}>
            <h4>{h}</h4>
            <p>{p}</p>
          </div>
        ))}
      </section>

      <MyProjects />

      <section>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Mezo integration — real testnet contracts</div>
        <div className="integration">
          <div className="card"><b>MUSD</b><span className="small muted">settlement currency, EIP-2612 permit funding</span><br /><code><a href={addressUrl(MEZO.musd)} target="_blank" rel="noreferrer">{MEZO.musd}</a></code></div>
          <div className="card"><b>Troves</b><span className="small muted">openTrove with hints; EIP-712 WithdrawMUSD / RepayMUSD into and out of escrow</span><br /><code><a href={addressUrl(MEZO.borrowerOpsSignatures)} target="_blank" rel="noreferrer">{MEZO.borrowerOpsSignatures}</a></code></div>
          <div className="card"><b>Savings Rate (sMUSD)</b><span className="small muted">idle budget earns protocol fees; PCV distribution poked on harvest</span><br /><code><a href={addressUrl(MEZO.savingsRate)} target="_blank" rel="noreferrer">{MEZO.savingsRate}</a></code></div>
          <div className="card"><b>MUSD/BTC pool</b><span className="small muted">contractor can be paid in BTC with slippage limit</span><br /><code><a href={addressUrl(MEZO.router)} target="_blank" rel="noreferrer">{MEZO.router}</a></code></div>
        </div>
        {deployment.factory && (
          <p className="small muted" style={{ marginTop: 10 }}>
            Build Fund factory <a className="mono" href={addressUrl(deployment.factory)} target="_blank" rel="noreferrer">{deployment.factory}</a>
            {deployment.lens && (
              <> · lens <a className="mono" href={addressUrl(deployment.lens)} target="_blank" rel="noreferrer">{deployment.lens}</a></>
            )}
            {deployment.transactions.length > 0 && <> · {deployment.transactions.length} demo transactions (<a href={txUrl(deployment.transactions[0].hash)} target="_blank" rel="noreferrer">first</a>)</>}
          </p>
        )}
      </section>
    </div>
  );
}

function ProjectLine({ address }: { address: `0x${string}` }) {
  const { data: p } = usePoll(() => loadProject(address), [address], 30000);
  if (!p) return <li className="small muted">{address}</li>;
  const paidPct = p.budget > 0n ? Number(((p.totalPaidToContractor + p.retentionHeld) * 100n) / p.budget) : 0;
  return (
    <li style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px dashed var(--line)" }}>
      <a href={`#/p/${address}`}>{p.title}</a>
      <span className="small muted mono">{musd(p.budget, 0)} MUSD · {paidPct}% paid</span>
    </li>
  );
}

function MyProjects() {
  const { signer } = useApp();
  const { data: mine } = usePoll(() => (signer ? projectsOf(signer.address) : Promise.resolve([])), [signer?.address], 30000);
  const { data: all } = usePoll(() => allProjects(), [], 60000);
  if (!deployment.factory) return null;
  const list = (signer && mine && mine.length ? mine : all) ?? [];
  return (
    <Card title={signer && mine?.length ? "Your build funds" : "Build funds on Mezo testnet"} sub={`${all?.length ?? 0} created so far`}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {list.slice(-12).reverse().map((a) => <ProjectLine key={a} address={a} />)}
      </ul>
    </Card>
  );
}
