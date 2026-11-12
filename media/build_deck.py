"""Builds the 10-slide project deck (HTML + PDF) from live deployment data.

    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 media/build_deck.py [--local]

Outputs media/out/deck.html and media/out/veridom-build-fund-deck.pdf. Individual slides are
also used as cards in the demo video (deck.html?slide=N).
"""
import asyncio, json, pathlib, sys, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "media" / "out"
OUT.mkdir(parents=True, exist_ok=True)
LOCAL = "--local" in sys.argv

dep = json.loads((ROOT / "contracts/deployments" / ("local-fork.json" if LOCAL else "mezo-testnet.json")).read_text()) \
    if (ROOT / "contracts/deployments" / ("local-fork.json" if LOCAL else "mezo-testnet.json")).exists() else {}
run_path = ROOT / "contracts/deployments" / ("demo-run-local.json" if LOCAL else "demo-run.json")
run = json.loads(run_path.read_text()) if run_path.exists() else {"txs": [], "projects": {}}
tests = json.loads((ROOT / "media/test-summary.json").read_text()) if (ROOT / "media/test-summary.json").exists() else {}

EXPLORER = "https://explorer.test.mezo.org"
PAGES = "https://khrisdidukh.github.io/veridom-mezo/"
n_tx = len(run["txs"])
factory = dep.get("factory", "deploying")
lens = dep.get("lens", "deploying")
unit = tests.get("unit", 49)
inv = tests.get("invariant", 3)
inv_calls = tests.get("invariant_calls", "128,000")
fork = tests.get("fork", 3)

def a(addr):
    return f'<span class="mono">{html.escape(addr)}</span>'

SLIDES = [
# 1 title
f"""
<div class="eyebrow">Mezo hackathon · Wave 2 · Track 1 DeFi + Track 2 Access</div>
<h1 class="big">Veridom <em>Build Fund</em></h1>
<p class="lead">Build your house on Bitcoin — without selling it.</p>
<p class="body">A construction escrow for private homebuilders: borrow MUSD against BTC, pay the contractor stage by stage,
and let the waiting budget earn MUSD Savings Rate yield. A new module of <b>Veridom</b>, the house-building control app live at
<b>veridom.space</b>.</p>
<div class="foot"><span>Khrystyna Didukh · Vienna</span><span>{PAGES}</span><span>github.com/khrisdidukh/veridom-mezo</span></div>
""",
# 2 problem
"""
<div class="eyebrow">The problem</div>
<h2>Building a house is a year-long trust problem with a pile of idle money in the middle.</h2>
<div class="cols3">
  <div class="box"><b>Owner vs. builder</b><p>Builders want money before they work, owners fear paying for work that is not done.
  Buyers from a developer get BTVG protection (stage plan + lawyer or notary as trustee). A private build with your own contractor gets none of it.</p></div>
  <div class="box"><b>Bitcoin holders sell</b><p>People who saved in BTC sell it to fund the build — a taxable event that gives up the upside
  of the asset they trusted most.</p></div>
  <div class="box"><b>Idle budget</b><p>A build budget is paid out over a year or more. Until each instalment is due it sits idle on a
  current account earning nothing.</p></div>
</div>
""",
# 3 solution
"""
<div class="eyebrow">The solution</div>
<h2>One escrow per house, wired into Mezo.</h2>
<div class="steps4">
  <div class="box"><span class="n">01</span><b>Borrow against BTC</b><p>Open a Mezo trove. Draws go straight into the escrow with one EIP-712 signature; an on-chain guard blocks draws below the ratio the owner chose.</p></div>
  <div class="box"><span class="n">02</span><b>Lock the plan</b><p>The contractor’s instalment plan becomes code: stages, deadlines, inspector, arbiter, 2–5 % retention. The contractor accepts on-chain.</p></div>
  <div class="box"><span class="n">03</span><b>Earn while waiting</b><p>Unreleased MUSD sits in the MUSD Savings Rate vault (sMUSD). Yield from protocol fees goes to the homeowner.</p></div>
  <div class="box"><span class="n">04</span><b>Pay on proof</b><p>A stage pays after owner + inspector sign-off — or automatically if the owner stays silent past the review window. Builder can take BTC.</p></div>
</div>
""",
# 4 money flow diagram
"""
<div class="eyebrow">How the money moves</div>
<h2>BTC stays the owner’s. MUSD does the work.</h2>
<svg viewBox="0 0 1160 420" class="diagram" role="img" aria-label="Money flow">
  <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#0f1c2e"/></marker></defs>
  <g font-family="Instrument Sans" font-size="15" fill="#0f1c2e">
    <rect x="10" y="40" width="190" height="86" rx="12" fill="#fdf0dd" stroke="#e8870e"/><text x="105" y="76" text-anchor="middle" font-weight="700">Homeowner BTC</text><text x="105" y="100" text-anchor="middle" font-size="13">collateral in Mezo trove</text>
    <rect x="270" y="40" width="210" height="86" rx="12" fill="#fff" stroke="#1f4e8c"/><text x="375" y="72" text-anchor="middle" font-weight="700">Mezo BorrowerOperations</text><text x="375" y="96" text-anchor="middle" font-size="13">openTrove · withdrawMUSD-</text><text x="375" y="114" text-anchor="middle" font-size="13">WithSignature (recipient = escrow)</text>
    <rect x="550" y="150" width="240" height="120" rx="14" fill="#0f1c2e"/><text x="670" y="190" text-anchor="middle" font-weight="700" fill="#f3f0e8" font-size="18">Build Fund escrow</text><text x="670" y="214" text-anchor="middle" fill="#9fb5d6" font-size="13">stages · sign-offs · deadlines</text><text x="670" y="234" text-anchor="middle" fill="#9fb5d6" font-size="13">disputes · retention · draw guard</text><text x="670" y="254" text-anchor="middle" fill="#9fb5d6" font-size="13">ownerless clone per project</text>
    <rect x="860" y="40" width="290" height="86" rx="12" fill="#e2f2e9" stroke="#1e7a4f"/><text x="1005" y="72" text-anchor="middle" font-weight="700">MUSD Savings Rate (sMUSD)</text><text x="1005" y="96" text-anchor="middle" font-size="13">waiting budget earns protocol fees</text><text x="1005" y="114" text-anchor="middle" font-size="13">PCV.distributeMUSD poked on harvest</text>
    <rect x="860" y="300" width="290" height="86" rx="12" fill="#fff" stroke="#1f4e8c"/><text x="1005" y="332" text-anchor="middle" font-weight="700">Contractor</text><text x="1005" y="356" text-anchor="middle" font-size="13">MUSD, or BTC via Mezo MUSD/BTC pool</text><text x="1005" y="374" text-anchor="middle" font-size="13">(min-out slippage limit)</text>
    <rect x="10" y="300" width="250" height="86" rx="12" fill="#fff" stroke="#6b7a8f"/><text x="135" y="332" text-anchor="middle" font-weight="700">Leftover / dispute remainder</text><text x="135" y="356" text-anchor="middle" font-size="13">repays the trove with a RepayMUSD</text><text x="135" y="374" text-anchor="middle" font-size="13">signature, or back to the wallet</text>
    <rect x="300" y="300" width="200" height="86" rx="12" fill="#fff" stroke="#6b7a8f"/><text x="400" y="336" text-anchor="middle" font-weight="700">Homeowner</text><text x="400" y="360" text-anchor="middle" font-size="13">receives all savings yield</text>
  </g>
  <g stroke="#0f1c2e" stroke-width="2" fill="none" marker-end="url(#ar)">
    <path d="M200 83 H266"/><path d="M480 83 C540 83 560 120 600 148"/><path d="M790 180 C830 150 840 110 858 100"/><path d="M880 126 C840 160 820 190 792 205"/>
    <path d="M790 240 C840 270 850 320 858 340"/><path d="M552 250 C500 300 300 330 262 340"/><path d="M880 120 C700 300 600 330 502 340"/>
  </g>
  <g font-family="JetBrains Mono" font-size="12" fill="#1f4e8c">
    <text x="206" y="74">BTC</text><text x="505" y="118">MUSD</text><text x="812" y="140">deposit</text><text x="812" y="190">withdraw</text><text x="812" y="300">stage pay</text><text x="380" y="300">repay</text><text x="640" y="300">yield</text>
  </g>
</svg>
""",
# 5 integration depth
f"""
<div class="eyebrow">Mezo integration — real testnet contracts, not mocks</div>
<h2>Eight touch-points across borrowing, savings and the DEX.</h2>
<table class="t">
<tr><th>Mezo primitive</th><th>What Build Fund does with it</th><th>Contract</th></tr>
<tr><td>MUSD</td><td>Settlement currency; one-tx funding with EIP-2612 permit</td><td>{a('0x1189…c503')}</td></tr>
<tr><td>BorrowerOperations</td><td>Owner opens a BTC trove in the app (sorted-list hints via HintHelpers/SortedTroves)</td><td>{a('0xCdF7…beE5')}</td></tr>
<tr><td>BorrowerOperationsSignatures</td><td><b>Draw-as-you-build:</b> WithdrawMUSD signature mints MUSD straight into the escrow; anyone can relay</td><td>{a('0xD757…639e')}</td></tr>
<tr><td>BorrowerOperationsSignatures</td><td><b>Close-out:</b> RepayMUSD signature burns unused budget against the owner’s debt</td><td>{a('0xD757…639e')}</td></tr>
<tr><td>TroveManager + PriceFeed</td><td>On-chain draw guard (min ICR) + BuildFundLens: ICR, liquidation price, after-draw preview</td><td>{a('0xE47c…6bb0')}</td></tr>
<tr><td>MUSD Savings Rate (sMUSD)</td><td>Idle budget deposited; yield index accounting; yield forwarded to owner</td><td>{a('0x6f46…8e16')}</td></tr>
<tr><td>PCV</td><td>Permissionless distributeMUSD() poked on harvest so fresh fees reach the vault</td><td>{a('0x4dDD…80Af')}</td></tr>
<tr><td>Router + MUSD/BTC pool</td><td>Contractor can be paid in BTC with a min-out limit</td><td>{a('0x9a1f…D7E9')}</td></tr>
</table>
<p class="note">Found on chain: the Savings Vault is live on testnet as <b>MUSDSavingsRate</b> at 0x6f461c…8e16 (PCV.feeRecipient) — a yield-index vault, not ERC-4626, so the escrow integrates its real interface.</p>
""",
# 6 rules
"""
<div class="eyebrow">Rules enforced by the contract</div>
<h2>Fair to both sides, with no admin key.</h2>
<div class="cols2">
<ul class="ticks">
<li><b>Two keys to pay:</b> homeowner approval + independent inspector (optional per project)</li>
<li><b>Silence is acceptance:</b> after the review window the contractor can claim (inspector still required)</li>
<li><b>Defects:</b> owner rejects inside the window; contractor fixes and re-requests</li>
<li><b>Disputes:</b> either side freezes a stage; a pre-agreed arbiter splits it</li>
</ul>
<ul class="ticks">
<li><b>Deadlines:</b> an undelivered stage can be cancelled after its date and the money freed</li>
<li><b>Retention:</b> 2–5 % of every payment held through the warranty; owner can flag defects</li>
<li><b>Draw guard:</b> trove draws that would leave the loan under the owner’s ratio revert</li>
<li><b>Ownerless:</b> no upgrade, no pause, no admin — Veridom cannot touch the money</li>
</ul>
</div>
""",
# 7 live
f"""
<div class="eyebrow">Live on Mezo testnet (chain 31611)</div>
<h2>Every feature executed on chain, by four separate wallets.</h2>
<div class="cols2">
<div>
<p class="body"><b>{n_tx} transactions</b> run the full lifecycle: trove opened, permit funding, relayed trove draw into escrow,
yield harvest, approvals and inspections, a stage accepted by silence and paid out <b>in BTC through the Mezo pool</b>,
defect → dispute → arbiter split, retention dispute, and unused budget repaying the trove.</p>
<p class="body small">Factory {a(factory)}<br>Lens {a(lens)}</p>
<p class="body small">Web app: {PAGES}</p>
</div>
<img class="shot" src="shot-project.png" alt="Build Fund project page"/>
</div>
""",
# 8 engineering
f"""
<div class="eyebrow">Engineering</div>
<h2>Tested like it will hold someone’s house money.</h2>
<div class="cols3">
  <div class="box"><span class="kpi">{unit}</span><b>unit tests</b><p>Happy path, review window, rejects, disputes, deadlines, retention, permit, signature draws &amp; repay, BTC payout, reentrancy, access control on every entry point.</p></div>
  <div class="box"><span class="kpi">{inv}</span><b>invariants · {inv_calls} calls each</b><p>sMUSD always equals tracked principal, no MUSD stranded, money conserved. The suite caught a real bug: retention could fund a later stage when under-funded — fixed and regression-tested.</p></div>
  <div class="box"><span class="kpi">{fork}</span><b>fork tests on real Mezo</b><p>Real trove, real EIP-712 draw and repay, real Savings Rate yield from PCV. Found that ActivePool pings the draw recipient — escrow now accepts zero-value calls only.</p></div>
</div>
<p class="note">Solidity 0.8.24 · Foundry · OpenZeppelin 5 · EIP-1167 clones · React + viem front end on GitHub Pages · contracts verified on the Mezo explorer.</p>
""",
# 9 business
"""
<div class="eyebrow">Product &amp; business</div>
<h2>An existing product adding MUSD rails — extend, don’t detour.</h2>
<div class="cols2">
<ul class="ticks">
<li><b>Veridom today:</b> house-building control app at veridom.space (Austria, Ukraine) — plans, checkpoints with photo sign-off, contractor access. MVP; no paying users yet.</li>
<li><b>Build Fund</b> turns Veridom’s checkpoint sign-off into the payment trigger: the evidence hash of each checkpoint is written on chain.</li>
<li><b>Who:</b> private homebuilders and renovators with BTC savings; their contractors; inspectors (Ziviltechniker).</li>
</ul>
<ul class="ticks">
<li><b>Why Mezo:</b> new MUSD demand that stays locked for a build cycle, plus deposits into the Savings Rate vault — sticky TVL, not mercenary yield.</li>
<li><b>Revenue (planned):</b> a small fee on released stages, inside the Veridom subscription.</li>
<li><b>Distribution:</b> Veridom users, contractors who invite their clients, and BTC communities in the DACH region and Ukraine.</li>
</ul>
</div>
""",
# 10 roadmap + team
"""
<div class="eyebrow">Next</div>
<h2>Roadmap and team</h2>
<div class="cols2">
<div>
<ol class="road">
<li><b>Wave 3 (by 30 Nov):</b> Mezo Passport so homeowners can connect a Bitcoin wallet; checkpoint photos in the app write the evidence hash automatically.</li>
<li><b>Q1 2027:</b> pilot with one Austrian renovation on testnet with a real contractor and inspector; contractor onboarding flow.</li>
<li><b>Before mainnet:</b> third-party audit, legal review of the escrow under Austrian law, mainnet launch inside Veridom.</li>
</ol>
</div>
<div class="box">
<b>Khrystyna Didukh</b> — founder of Veridom, Vienna. Co-founder &amp; CTO of Avara Bio. Ran 358, an exotic-flower import business, for ten years
(2012–2022) and built its web shops, apps and CRM. Three years at PwC. Estonia e-Residency Envoy, UNDP Woman Innovator. Builds her
products herself with AI coding tools.
<p class="small muted">Built for the Mezo “Build with MUSD and MEZO” hackathon, Nov 2026. Testnet only.</p>
</div>
</div>
""",
]

CSS = """
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: "Instrument Sans", sans-serif; color: #0f1c2e; background: #ddd; }
.slide { width: 1280px; height: 720px; position: relative; overflow: hidden; padding: 64px 72px; page-break-after: always;
  background-color: #f3f0e8; background-image: linear-gradient(rgba(31,78,140,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(31,78,140,.07) 1px, transparent 1px);
  background-size: 28px 28px; }
.slide .pg { position: absolute; right: 40px; bottom: 26px; font: 12px "JetBrains Mono", monospace; color: #6b7a8f; }
.slide .logo { position: absolute; left: 72px; bottom: 26px; font: 600 13px "Instrument Sans"; color: #3b4a5e; display: flex; gap: 8px; align-items: center; }
.eyebrow { font: 13px "JetBrains Mono", monospace; letter-spacing: .08em; text-transform: uppercase; color: #1f4e8c; margin-bottom: 14px; }
h1, h2 { font-family: "Instrument Serif", serif; font-weight: 400; margin: 0 0 26px; letter-spacing: -0.01em; }
h1.big { font-size: 104px; line-height: 1; margin-top: 40px; }
h1 em, h2 em { color: #e8870e; }
h2 { font-size: 46px; line-height: 1.08; max-width: 1080px; }
.lead { font-size: 34px; margin: 6px 0 22px; font-family: "Instrument Serif", serif; }
.body { font-size: 19px; line-height: 1.5; max-width: 900px; color: #3b4a5e; }
.small { font-size: 14px; }
.muted { color: #6b7a8f; }
.mono { font-family: "JetBrains Mono", monospace; font-size: .92em; }
.foot { position: absolute; left: 72px; right: 72px; bottom: 60px; display: flex; justify-content: space-between; font: 14px "JetBrains Mono", monospace; color: #1f4e8c; }
.cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.cols3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.steps4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.box { background: #fbfaf6; border: 1px solid #d9d3c4; border-radius: 14px; padding: 20px; box-shadow: 0 8px 24px -14px rgba(15,28,46,.25); font-size: 16px; line-height: 1.45; }
.box b { display: block; font-size: 18px; margin-bottom: 6px; }
.box p { margin: 0; color: #3b4a5e; }
.box .n { font: 13px "JetBrains Mono"; color: #1f4e8c; display: block; margin-bottom: 8px; }
.kpi { font: 600 48px "JetBrains Mono", monospace; color: #1f4e8c; display: block; letter-spacing: -.03em; }
.t { width: 100%; border-collapse: collapse; font-size: 15px; background: #fbfaf6; border-radius: 12px; overflow: hidden; }
.t th { text-align: left; padding: 9px 12px; background: #0f1c2e; color: #f3f0e8; font-weight: 600; font-size: 13px; }
.t td { padding: 8px 12px; border-top: 1px solid #e6e1d4; vertical-align: top; }
.note { font-size: 14px; color: #3b4a5e; margin-top: 14px; }
.ticks { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; font-size: 18px; line-height: 1.4; }
.ticks li { padding-left: 30px; position: relative; }
.ticks li::before { content: "✓"; position: absolute; left: 0; top: 0; color: #1e7a4f; font-weight: 700; }
.road { font-size: 18px; line-height: 1.45; padding-left: 22px; display: grid; gap: 14px; margin: 0; }
.diagram { width: 100%; height: auto; }
.shot { width: 100%; border-radius: 12px; border: 1px solid #d9d3c4; box-shadow: 0 10px 30px -12px rgba(15,28,46,.35); }
/* single-slide mode for video cards */
body.single { background: #f3f0e8; display: grid; place-items: center; width: 100vw; height: 100vh; overflow: hidden; }
body.single .slide { transform-origin: center; }
"""

LOGO = '<svg width="20" height="20" viewBox="0 0 26 26"><rect x="1" y="1" width="24" height="24" rx="6" fill="#0f1c2e"/><path d="M6 14 L13 7 L20 14" stroke="#f3f0e8" stroke-width="2" fill="none"/><circle cx="13" cy="16.3" r="1.7" fill="#e8870e"/></svg>'

def build_html():
    slides = "\n".join(
        f'<section class="slide" id="s{i+1}">{s}<div class="logo">{LOGO} Veridom Build Fund</div><div class="pg">{i+1:02d} / {len(SLIDES):02d}</div></section>'
        for i, s in enumerate(SLIDES))
    js = """<script>
const q = new URLSearchParams(location.search); const n = q.get('slide');
if (n) { document.body.classList.add('single'); document.querySelectorAll('.slide').forEach((s,i)=>{ if (i+1 != n) s.remove(); });
  const fit = () => { const s = document.querySelector('.slide'); const k = Math.min(innerWidth/1280, innerHeight/720); s.style.transform = `scale(${k})`; };
  addEventListener('resize', fit); fit(); }
</script>"""
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Veridom Build Fund — deck</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>{slides}{js}</body></html>"""
    (OUT / "deck.html").write_text(doc)

async def render_pdf():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        await pg.goto((OUT / "deck.html").as_uri())
        await pg.wait_for_timeout(2500)
        await pg.pdf(path=str(OUT / "veridom-build-fund-deck.pdf"), width="1280px", height="720px", print_background=True)
        for i in (1, 4, 5, 8):
            await pg.goto((OUT / "deck.html").as_uri() + f"?slide={i}")
            await pg.wait_for_timeout(800)
            await pg.screenshot(path=str(OUT / f"slide-{i:02d}.png"))
        await b.close()

if __name__ == "__main__":
    build_html()
    asyncio.run(render_pdf())
    print("deck:", OUT / "veridom-build-fund-deck.pdf")
