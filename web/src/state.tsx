import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Hash } from "viem";
import { connectInjected, devSigners, errorText, type Signer } from "./lib/wallet";
import { txUrl } from "./config";

type Toast = { id: number; text: string; hash?: string; error?: boolean };

type AppState = {
  signer: Signer | null;
  devRoles: Signer[];
  connect: () => Promise<void>;
  useDevRole: (label: string) => void;
  toasts: Toast[];
  notify: (text: string, opts?: { hash?: string; error?: boolean }) => void;
  /** Runs a transaction flow with progress/success/error toasts. Returns the final hash or null. */
  run: (label: string, fn: (s: Signer) => Promise<Hash | void>) => Promise<Hash | null>;
  busy: string | null;
  refreshKey: number;
  refresh: () => void;
};

const Ctx = createContext<AppState | null>(null);

/** Tiny progress counter for automated UI tests and the demo recording harness. */
function txCounter(kind: "ok" | "err", detail: string) {
  const w = window as unknown as { __veridomTx?: { ok: number; err: number; last: string } };
  w.__veridomTx ??= { ok: 0, err: 0, last: "" };
  w.__veridomTx[kind] += 1;
  w.__veridomTx.last = detail;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const devRoles = useMemo(() => devSigners(), []);
  const [signer, setSigner] = useState<Signer | null>(devRoles[0] ?? null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const notify = useCallback((text: string, opts: { hash?: string; error?: boolean } = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.error ? 9000 : 6500);
  }, []);

  const connect = useCallback(async () => {
    try {
      setSigner(await connectInjected());
    } catch (e) {
      notify(errorText(e), { error: true });
    }
  }, [notify]);

  const useDevRole = useCallback(
    (label: string) => setSigner(devRoles.find((s) => s.label === label) ?? null),
    [devRoles],
  );

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const run = useCallback(
    async (label: string, fn: (s: Signer) => Promise<Hash | void>) => {
      if (!signer) {
        notify("Connect a wallet first.", { error: true });
        return null;
      }
      setBusy(label);
      try {
        const hash = await fn(signer);
        notify(`${label} — confirmed`, { hash: hash ?? undefined });
        txCounter("ok", label);
        refresh();
        return hash ?? null;
      } catch (e) {
        notify(`${label} failed: ${errorText(e)}`, { error: true });
        txCounter("err", `${label}: ${errorText(e)}`);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [signer, notify, refresh],
  );

  useEffect(() => {
    const eth = (window as unknown as { ethereum?: { on?: (e: string, f: () => void) => void } }).ethereum;
    eth?.on?.("accountsChanged", () => {
      if (signer?.kind === "injected") void connect();
    });
  }, [signer, connect]);

  return (
    <Ctx.Provider value={{ signer, devRoles, connect, useDevRole, toasts, notify, run, busy, refreshKey, refresh }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? "err" : ""}`}>
            {t.text}
            {t.hash && (
              <>
                {" · "}
                <a href={txUrl(t.hash)} target="_blank" rel="noreferrer">
                  view tx
                </a>
              </>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

/** Re-runs `load` on mount, on refresh, and every `everyMs`. */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], everyMs = 8000) {
  const { refreshKey } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      load()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(errorText(e)));
    tick();
    const t = setInterval(tick, everyMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey]);
  return { data, error };
}
