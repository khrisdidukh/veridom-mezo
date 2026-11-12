/**
 * Instalment-plan templates. Starting points for the homeowner and contractor to edit together —
 * not legal advice.
 *
 * Austria: Bauträgervertragsgesetz (BTVG) §10 Ratenplan B — 10 % start of works, 30 % shell & roof,
 * 20 % rough-in, 12 % facade & windows, 17 % ready to move in, 9 % completion; the BTVG also requires
 * at least 2 % to be held back for 3 years after handover (Haftrücklass). The BTVG binds developers
 * (Bauträger); for a private build with a general contractor it is the familiar reference plan.
 *
 * Germany: Makler- und Bauträgerverordnung (MaBV) §3(2) — 30 % after the start of earthworks, the
 * remaining 70 % by trade (40/8/3/3/3/10/6/3/4/12/3/5 %), bundled here into 7 instalments.
 */
export type Template = {
  id: string;
  label: string;
  note: string;
  retentionBps: number;
  warrantyDays: number;
  stages: { name: string; share: number }[];
};

export const TEMPLATES: Template[] = [
  {
    id: "at-btvg-b",
    label: "Austria · BTVG Ratenplan B",
    note: "6 instalments + 2 % Haftrücklass held for 3 years",
    retentionBps: 200,
    warrantyDays: 3 * 365,
    stages: [
      { name: "Start of works", share: 10 },
      { name: "Shell & roof", share: 30 },
      { name: "Rough-in installations", share: 20 },
      { name: "Facade & windows", share: 12 },
      { name: "Ready to move in", share: 17 },
      { name: "Completion", share: 11 },
    ],
  },
  {
    id: "de-mabv",
    label: "Germany · MaBV §3 (7 instalments)",
    note: "30 % at earthworks, the rest by trade; 5 % retention suggested",
    retentionBps: 500,
    warrantyDays: 5 * 365,
    stages: [
      { name: "Earthworks started", share: 30 },
      { name: "Shell incl. carpentry", share: 28 },
      { name: "Roof + rough-in", share: 11.9 },
      { name: "Windows, plaster, screed", share: 13.3 },
      { name: "Tiling + facade", share: 4.9 },
      { name: "Ready to move in", share: 8.4 },
      { name: "Full completion", share: 3.5 },
    ],
  },
  {
    id: "generic-5",
    label: "Generic · 5 stages (UA / other)",
    note: "Slab, walls, roof, rough-in, finish; 5 % retention for 1 year",
    retentionBps: 500,
    warrantyDays: 365,
    stages: [
      { name: "Foundation slab", share: 15 },
      { name: "Walls", share: 25 },
      { name: "Roof", share: 20 },
      { name: "Rough-in", share: 20 },
      { name: "Finish", share: 20 },
    ],
  },
];
