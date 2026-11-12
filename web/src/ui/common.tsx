import { useState, type ReactNode } from "react";
import { addressUrl } from "../config";
import { short } from "../lib/format";
import { useApp } from "../state";

export function Addr({ a, label }: { a: string; label?: string }) {
  const { signer } = useApp();
  const me = signer && signer.address.toLowerCase() === a.toLowerCase();
  if (/^0x0{40}$/.test(a)) return <span className="muted">none</span>;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <a className="mono small" href={addressUrl(a)} target="_blank" rel="noreferrer" title={a}>
        {label ?? short(a)}
      </a>
      {me && <span className="chip you">you</span>}
    </span>
  );
}

export function Card({ title, sub, right, children, id }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card" id={id}>
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Button that first asks for a short note (hashed on-chain), then confirms. */
export function NoteAction({
  label,
  placeholder,
  className = "btn sm ghost",
  onConfirm,
}: {
  label: string;
  placeholder: string;
  className?: string;
  onConfirm: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { busy } = useApp();
  if (!open)
    return (
      <button className={className} onClick={() => setOpen(true)} disabled={!!busy}>
        {label}
      </button>
    );
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "1 1 320px" }}>
      <input autoFocus value={note} placeholder={placeholder} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 180 }} />
      <button
        className="btn sm"
        disabled={!!busy || !note.trim()}
        onClick={() => {
          onConfirm(note.trim());
          setOpen(false);
          setNote("");
        }}
      >
        {label}
      </button>
      <button className="btn sm ghost" onClick={() => setOpen(false)}>
        ✕
      </button>
    </span>
  );
}

export function AmountInput({ value, onChange, unit = "MUSD", max }: { value: string; onChange: (v: string) => void; unit?: string; max?: string }) {
  return (
    <div className="input-suffix">
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(",", "."))} placeholder="0" className="mono" />
      <span>
        {max !== undefined && (
          <a href="#max" onClick={(e) => (e.preventDefault(), onChange(max))} style={{ marginRight: 8 }}>
            max
          </a>
        )}
        {unit}
      </span>
    </div>
  );
}
