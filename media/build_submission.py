"""Writes the AKINDO submission text (every form field, ready to paste) from live deployment data.

    python3 media/build_submission.py  ->  media/out/veridom-mezo-submission.md
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "media" / "out"
X = "https://explorer.test.mezo.org"
dep_p = ROOT / "contracts/deployments/mezo-testnet.json"
run_p = ROOT / "contracts/deployments/demo-run.json"
dep = json.loads(dep_p.read_text()) if dep_p.exists() else {}
run = json.loads(run_p.read_text()) if run_p.exists() else {"txs": [], "projects": {}}
tests = json.loads((ROOT / "media/test-summary.json").read_text())
deployed = bool(dep.get("factory"))

APP = "https://khrisdidukh.github.io/veridom-mezo/"
REPO = "https://github.com/khrisdidukh/veridom-mezo"
DECK = f"{REPO}/blob/main/docs/veridom-build-fund-deck.pdf"
VIDEO_FALLBACK = f"{REPO}/blob/main/docs/veridom-build-fund-demo.mp4"

def link(a):
    return f"{X}/address/{a}"

btc_tx = next((t for t in run["txs"] if "in BTC" in t["label"]), None)
draw_tx = next((t for t in run["txs"] if "trove draw" in t["label"]), None)
repay_tx = next((t for t in run["txs"] if "repays" in t["label"]), None)
harvest_tx = next((t for t in run["txs"] if t["label"].startswith("Harvest")), None)

def tx(t):
    return f"{X}/tx/{t['hash']}" if t else "(see README)"

addresses = (f"""- BuildFundFactory: {dep['factory']} — {link(dep['factory'])}
- BuildFundEscrow implementation: {dep['escrowImplementation']}
- BuildFundLens: {dep['lens']} — {link(dep['lens'])}
- Demo project A (complete lifecycle): {run['projects'].get('A', '—')}
- Demo project B (in progress, opens by default in the app): {run['projects'].get('B', '—')}""" if deployed else "- (fill in after the testnet deployment)")

md = f"""# Veridom Build Fund — AKINDO submission (Mezo “Build with MUSD and MEZO”, Wave 2)

Copy each block into the matching field. Links marked ⚠ need your action first (see the Ukrainian step list).

---

## Project name
Veridom Build Fund

## Category (3–5 words)
BTC-backed construction escrow

## Links
- Live app (Mezo testnet): {APP}
- GitHub (public): {REPO}
- Project deck (PDF): {DECK}
- 2-minute pitch video: ⚠ your YouTube link — fallback file in the repo: {VIDEO_FALLBACK}
- Existing product: https://veridom.space

## TL;DR
Build your house on Bitcoin without selling it. Veridom Build Fund is a construction escrow on Mezo: the homeowner borrows MUSD against her BTC (or brings MUSD), the contractor’s instalment plan is locked in an ownerless escrow, each stage is paid only after homeowner + inspector sign-off (or automatically after a silent review window), and the money waiting for its stage earns MUSD Savings Rate yield. The contractor can take payment in BTC via the Mezo MUSD/BTC pool, and unused budget repays the trove with one signature. It is a new module of Veridom (veridom.space), a live house-building control app for private homebuilders in Austria and Ukraine.

## How it works
1. Borrow: the homeowner opens a Mezo trove in the app (BorrowerOperations.openTrove with HintHelpers/SortedTroves hints). To fund the build she signs one EIP-712 WithdrawMUSD message with recipient = the escrow; anyone can relay it and Mezo’s BorrowerOperationsSignatures mints the MUSD straight into the escrow. An on-chain draw guard reverts any draw that would leave her trove below the collateral ratio she chose (read from TroveManager + PriceFeed). MUSD from a wallet can be added with an EIP-2612 permit in one transaction.
2. Lock the plan: one EIP-1167 clone per house holds the stages (e.g. Austrian BTVG Ratenplan B), deadlines, review window, retention (2–5 %), warranty period, inspector and arbiter. The contractor accepts on-chain. No owner, no upgrade, no pause.
3. Earn while waiting: all unreleased MUSD sits in the MUSD Savings Rate vault (sMUSD). harvest() is permissionless: it pokes PCV.distributeMUSD() and forwards the vault yield to the homeowner; yield paid together with withdrawals is forwarded too, so principal accounting stays exact.
4. Pay on proof: the contractor requests a stage with the hash of the Veridom checkpoint record (photos, signatures). It becomes payable after homeowner approval + inspector sign-off, or when the review window passes without objection (inspector still required). Rejections, disputes with an arbiter split, cancellation after deadlines and a warranty retention with defect claims are all enforced by the contract. The contractor claims in MUSD or in BTC through the Mezo router with a min-out limit.
5. Close out: leftover money (over-funding, cancelled stages, dispute remainders, retention claims) pays down the homeowner’s trove through a RepayMUSD signature, or goes back to her wallet.

Mezo touch-points (all real testnet contracts): MUSD, BorrowerOperations, BorrowerOperationsSignatures (withdraw + repay), TroveManager, PriceFeed, HintHelpers/SortedTroves, MUSD Savings Rate vault (sMUSD), PCV, Router + MUSD/BTC pool.
Note: the docs list the mainnet Savings Vault; on testnet I found the live vault as PCV.feeRecipient() — a MUSDSavingsRate yield-index contract (not ERC-4626) — and integrated its real interface.

## Target group
Private homebuilders and renovators who hold BTC — first in Austria (and the wider DACH region) and Ukraine, Veridom’s markets — and their contractors and independent inspectors (Ziviltechniker / Bausachverständige). It gives non-crypto homeowners a plain-language web app with a role-based “next step” guide, while Bitcoin holders keep their BTC instead of selling it to pay for the build.

## Tech stack
Solidity 0.8.24, Foundry (forge, anvil), OpenZeppelin 5 (Clones, SafeERC20, ReentrancyGuard, Initializable), EIP-712 / EIP-2612 signatures; React 18 + TypeScript + Vite + viem (multicall, typed-data signing) on GitHub Pages; Playwright + ffmpeg for the demo; GitHub Actions CI. Tests: {tests['unit']} unit tests, {tests['invariant']} invariant tests ({tests['invariant_calls']} random calls each), {tests['fork']} fork tests against the real Mezo testnet contracts.

## Track
Track 1 — DeFi (borrowing/lending/yield) and Track 2 — Access & Distribution

## Chain
Mezo Testnet (chain ID 31611)

## Status
Working deployment on Mezo testnet with verified contracts and a live web app. Every feature has been executed on chain{f" in {len(run['txs'])} transactions" if run['txs'] else ""} by four separate wallets (homeowner, contractor, inspector, arbiter/relayer), including a relayed trove draw into the escrow, Savings Rate yield, a stage accepted by silence and paid in BTC through the Mezo pool, a dispute split, a warranty claim and a trove repayment from leftover budget. Testnet only, not audited, no real users yet. Veridom itself (veridom.space) is a live MVP without paying users yet.

## Readiness
Working testnet prototype (beyond a demo): ownerless contracts with unit, invariant and fork tests, deployed and verified on Mezo testnet; usable web app for all four roles; full lifecycle executed on chain. Not audited; mainnet only after an audit and a legal review.

## Next 3 milestones
1. Wave 3 (by 30 Nov 2026): Mezo Passport so homeowners can connect a Bitcoin wallet; Veridom checkpoints write the evidence hash automatically; change orders (Nachträge) as signed stage amendments.
2. Q1 2027: pilot with one real Austrian renovation on testnet — homeowner, contractor and an independent inspector — and a contractor onboarding flow.
3. Before mainnet: third-party security audit, legal review of the escrow model under Austrian law, launch on Mezo mainnet inside Veridom.

## Team info
Khrystyna Didukh (Vienna, Austria) — solo builder. Founder of Veridom (veridom.space), co-founder & CTO of Avara Bio. Ran 358, an exotic-flower import business in Ukraine, for ten years (2012–2022) and directed its web shops, mobile apps and CRM; three years at PwC; two MA degrees (Ivan Franko University, Lviv). Estonia e-Residency Envoy and UNDP Woman Innovator. GitHub: khrisdidukh · LinkedIn: linkedin.com/in/khrystynadidukh358

---

## On-chain proof (for the description or a comment)
{addresses}
- Relayed trove draw into escrow: {tx(draw_tx)}
- Savings Rate yield harvest: {tx(harvest_tx)}
- Stage paid in BTC via Mezo pool: {tx(btc_tx)}
- Leftover budget repays the trove: {tx(repay_tx)}
- Full list of transactions: {REPO}#deployment-mezo-testnet-chain-31611
"""
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "veridom-mezo-submission.md").write_text(md)
print("written", OUT / "veridom-mezo-submission.md", "(deployed)" if deployed else "(placeholders)")
