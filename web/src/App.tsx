import { useEffect, useState } from "react";
import type { Address } from "viem";
import { deployment, NETWORK_LABEL } from "./config";
import { short } from "./lib/format";
import { useApp } from "./state";
import { Home } from "./ui/Home";
import { ProjectView } from "./ui/ProjectView";
import { CreateProject } from "./ui/CreateProject";
import { BorrowPage } from "./ui/Borrow";

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => {
      setHash(location.hash);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return hash;
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect x="1" y="1" width="24" height="24" rx="6" fill="#0f1c2e" />
      <path d="M6 14 L13 7 L20 14" stroke="#f3f0e8" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <path d="M8.5 13 V19.5 H17.5 V13" stroke="#f3f0e8" strokeWidth="2" fill="none" strokeDasharray="2 1.6" />
      <circle cx="13" cy="16.3" r="1.7" fill="#e8870e" />
    </svg>
  );
}

export default function App() {
  const hash = useHash();
  const { signer, devRoles, connect, useDevRole } = useApp();
  const route = hash.replace(/^#/, "") || "/";
  const projectMatch = route.match(/^\/p\/(0x[0-9a-fA-F]{40})/);

  let page = <Home />;
  if (projectMatch) page = <ProjectView address={projectMatch[1] as Address} />;
  else if (route.startsWith("/new")) page = <CreateProject />;
  else if (route.startsWith("/borrow")) page = <BorrowPage />;

  const link = (to: string, label: string) => (
    <a href={`#${to}`} className={route === to || (to !== "/" && route.startsWith(to)) ? "active" : ""}>{label}</a>
  );

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <a className="brand" href="#/"><Logo /> Veridom <small>Build Fund</small></a>
          <nav className="nav">
            {link("/", "Overview")}
            {deployment.demoProject && link(`/p/${deployment.demoProject}`, "Live demo")}
            {link("/new", "New build fund")}
            {link("/borrow", "BTC loan")}
          </nav>
          <div className="spacer" />
          <span className="netpill"><span className="dot" /> {NETWORK_LABEL}</span>
          {devRoles.length > 0 ? (
            <div className="roles" role="group" aria-label="Act as">
              {devRoles.map((r) => (
                <button key={r.label} className={signer?.label === r.label ? "on" : ""} onClick={() => useDevRole(r.label)}>{r.label}</button>
              ))}
            </div>
          ) : signer ? (
            <span className="netpill mono">{short(signer.address)}</span>
          ) : (
            <button className="btn sm" onClick={connect}>Connect wallet</button>
          )}
        </div>
      </header>
      <main>
        <div className="wrap">{page}</div>
      </main>
      <footer>
        <div className="wrap" style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }}>
          <span>Veridom Build Fund — open source, ownerless contracts on Mezo testnet (chain 31611). Not financial or legal advice.</span>
          <span>
            <a href="https://veridom.space" target="_blank" rel="noreferrer">veridom.space</a> ·{" "}
            <a href="https://github.com/khrisdidukh/veridom-mezo" target="_blank" rel="noreferrer">GitHub</a> ·{" "}
            <a href="https://mezo.org/docs/developers/" target="_blank" rel="noreferrer">Mezo docs</a>
          </span>
        </div>
      </footer>
    </>
  );
}
