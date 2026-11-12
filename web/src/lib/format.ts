import { formatUnits } from "viem";

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

/** MUSD with thousands separators, 2 decimals max. */
export function musd(v: bigint, digits = 2): string {
  const n = Number(formatUnits(v, 18));
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function btc(v: bigint, digits = 5): string {
  return Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

export const usd = (v: bigint) =>
  `$${Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** 1e18-scaled ratio as percent. */
export const pct = (v: bigint, digits = 0) => `${(Number(formatUnits(v, 16))).toFixed(digits)}%`;

export function duration(seconds: number): string {
  const s = Math.abs(seconds);
  if (s >= 86400 * 365) return `${Math.round(s / (86400 * 365))} y`;
  if (s >= 86400 * 2) return `${Math.round(s / 86400)} days`;
  if (s >= 3600 * 2) return `${Math.round(s / 3600)} h`;
  if (s >= 120) return `${Math.round(s / 60)} min`;
  return `${Math.round(s)} s`;
}

export function relative(ts: number, now = Date.now() / 1000): string {
  const d = ts - now;
  if (Math.abs(d) < 60) return "just now";
  return d >= 0 ? `in ${duration(d)}` : `${duration(-d)} ago`;
}

export const date = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
