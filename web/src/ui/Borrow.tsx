import { useEffect, useMemo, useState } from "react";
import { parseAbi, parseUnits } from "viem";
import { MEZO, FAUCET } from "../config";
import { btc, musd, pct, usd } from "../lib/format";
import { openTroveArgs } from "../lib/mezo";
import { loadTroveHealth } from "../lib/project";
import { publicClient, send } from "../lib/wallet";
import { useApp, usePoll } from "../state";
import { AmountInput, Card } from "./common";

const priceAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);

/** Open a Mezo trove (BTC-backed MUSD loan) directly through BorrowerOperations. */
export function OpenTrove({ compact = false }: { compact?: boolean }) {
  const { signer, run, busy } = useApp();
  const [coll, setColl] = useState("0.1");
  const [debt, setDebt] = useState("2000");
  const [price, setPrice] = useState<bigint | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);

  useEffect(() => {
    publicClient.readContract({ address: MEZO.priceFeed, abi: priceAbi, functionName: "fetchPrice" }).then(setPrice).catch(() => setPrice(null));
    if (signer) publicClient.getBalance({ address: signer.address }).then(setBal).catch(() => setBal(null));
  }, [signer]);

  const { collWei, debtWei } = useMemo(() => {
    try {
      return { collWei: parseUnits(coll || "0", 18), debtWei: parseUnits(debt || "0", 18) };
    } catch {
      return { collWei: 0n, debtWei: 0n };
    }
  }, [coll, debt]);
  // 0.1 % borrowing fee + 200 MUSD gas compensation (refunded when the loan is closed)
  const totalDebt = debtWei + debtWei / 1000n + 200n * 10n ** 18n;
  const icr = price && totalDebt > 0n ? (collWei * price) / totalDebt : 0n;
  const liq = collWei > 0n ? (totalDebt * 11n * 10n ** 17n) / collWei : 0n;
  const tooSmall = debtWei < 1800n * 10n ** 18n;
  const risky = icr > 0n && icr < 150n * 10n ** 16n;

  const body = (
    <div className="grid" style={{ gap: 10 }}>
      <div className="small">Lock BTC, mint MUSD. You keep your bitcoin — repay any time to unlock it.</div>
      <label className="field">BTC collateral<AmountInput value={coll} onChange={setColl} unit="BTC" /></label>
      <label className="field">MUSD to borrow (min 1,800)<AmountInput value={debt} onChange={setDebt} /></label>
      <dl className="kv small">
        <dt>BTC price (Mezo oracle)</dt><dd>{price ? usd(price) : "—"}</dd>
        <dt>Total debt incl. fee + 200 gas deposit</dt><dd>{musd(totalDebt)}</dd>
        <dt>Collateral ratio</dt><dd>{icr ? pct(icr) : "—"}</dd>
        <dt>Liquidation price</dt><dd>{liq ? usd(liq) : "—"}</dd>
        <dt>Your BTC balance</dt><dd>{bal === null ? "—" : btc(bal)}</dd>
      </dl>
      {tooSmall && <div className="callout warn">Mezo’s minimum loan is 1,800 MUSD.</div>}
      {risky && <div className="callout bad">Below 150% the loan is fragile. Add collateral or borrow less.</div>}
      {bal !== null && bal < collWei && (
        <div className="callout info">
          Not enough testnet BTC. Get some at <a href={FAUCET} target="_blank" rel="noreferrer">faucet.test.mezo.org</a>.
        </div>
      )}
      <button
        className="btn btc"
        disabled={!!busy || tooSmall || collWei === 0n || !signer}
        onClick={() => run(`Open BTC loan for ${musd(debtWei)} MUSD`, async (s) => send(s, await openTroveArgs(collWei, debtWei)))}
      >
        Open BTC-backed loan
      </button>
    </div>
  );
  return compact ? body : <Card title="Borrow MUSD against your BTC" sub="Mezo BorrowerOperations.openTrove, with sorted-list hints">{body}</Card>;
}

export function BorrowPage() {
  const { signer, connect } = useApp();
  const { data: trove } = usePoll(() => (signer ? loadTroveHealth(signer.address) : Promise.resolve(null)), [signer?.address], 10000);
  if (!signer)
    return (
      <div className="card">
        <p>Connect a wallet to see or open your Mezo loan.</p>
        <button className="btn" onClick={connect}>Connect wallet</button>
      </div>
    );
  return (
    <div className="grid cols-2">
      <OpenTrove />
      <Card title="Your loan" sub="Live from Mezo TroveManager">
        {trove?.status === 1 ? (
          <dl className="kv">
            <dt>Collateral</dt><dd>{btc(trove.coll)} BTC</dd>
            <dt>Debt</dt><dd>{musd(trove.debt)} MUSD</dd>
            <dt>Collateral ratio</dt><dd>{pct(trove.icr)}</dd>
            <dt>Liquidation price</dt><dd>{usd(trove.liquidationPrice)}</dd>
          </dl>
        ) : (
          <div className="small muted">No open loan yet.</div>
        )}
      </Card>
    </div>
  );
}
