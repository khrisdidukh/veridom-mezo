"""Records the ~2-minute demo video by driving the real web app with Playwright.

Every action in the video is a real transaction sent from the UI (testnet, or a local fork with
--local). Captions are drawn into the page (burned in) and also written to an .srt file; the
narration script lives in media/narration.md.

    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 media/record_demo.py [--local] [--url http://localhost:5199/]
"""
import asyncio, json, pathlib, subprocess, sys, time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from harness import init_script, ROOT  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

LOCAL = "--local" in sys.argv
URL = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:5199/"
RPC = "http://127.0.0.1:8547" if LOCAL else "https://rpc.test.mezo.org"
DEP = "local-fork.json" if LOCAL else "mezo-testnet.json"
OUT = ROOT / "media" / "out"
RAW = OUT / "raw"
RAW.mkdir(parents=True, exist_ok=True)
DECK = (OUT / "deck.html").as_uri()
W, H = 1440, 810

addr = {n: (ROOT / "keys" / f"{n}.addr").read_text().strip() for n in ["contractor", "inspector", "deployer"]}
run = json.loads((ROOT / "contracts/deployments" / ("demo-run-local.json" if LOCAL else "demo-run.json")).read_text())

CAPTION_JS = """
(text) => {
  let el = document.getElementById('__cap');
  if (!el) {
    el = document.createElement('div'); el.id = '__cap';
    Object.assign(el.style, {position:'fixed', left:'50%', bottom:'26px', transform:'translateX(-50%)', zIndex: 99999,
      maxWidth:'1100px', padding:'12px 22px', borderRadius:'14px', background:'rgba(15,28,46,.92)', color:'#f8f5ee',
      font:'600 24px/1.35 "Instrument Sans", system-ui, sans-serif', textAlign:'center', boxShadow:'0 10px 30px rgba(0,0,0,.25)',
      transition:'opacity .25s'});
    document.body.appendChild(el);
  }
  el.textContent = text; el.style.opacity = text ? '1' : '0';
}
"""

timeline = []   # (t, caption)
fast = []       # (t0, t1) intervals to speed up (waiting for blocks)
T0 = None


def now():
    return time.monotonic() - T0


async def cap(page, text):
    timeline.append((now(), text))
    await page.evaluate(CAPTION_JS, text)


async def tx(page, click, label):
    """Perform a UI action that sends a transaction and wait until it is confirmed."""
    before = await page.evaluate("() => (window.__veridomTx && window.__veridomTx.ok) || 0")
    errs = await page.evaluate("() => (window.__veridomTx && window.__veridomTx.err) || 0")
    await click()
    t0 = now()
    for _ in range(600):
        st = await page.evaluate("() => window.__veridomTx || {ok:0, err:0, last:''}")
        if st["ok"] > before:
            break
        if st["err"] > errs:
            raise RuntimeError(f"{label} failed in UI: {st['last']}")
        await page.wait_for_timeout(250)
    else:
        raise RuntimeError(f"{label} timed out")
    t1 = now()
    if t1 - t0 > 2.5:
        fast.append((t0 + 0.8, t1 - 0.4))
    await page.wait_for_timeout(1500)  # let the page refresh and the toast show


async def role(page, name):
    await page.locator(".roles button", has_text=name).click()
    await page.wait_for_timeout(900)


async def note_action(page, scope, label, text):
    await scope.get_by_role("button", name=label, exact=False).first.click()
    await page.keyboard.type(text, delay=25)
    await scope.get_by_role("button", name=label, exact=False).first.click()


async def slide(page, n, caption, secs):
    await page.goto(f"{DECK}?slide={n}")
    await page.wait_for_timeout(600)
    await cap(page, caption)
    await page.wait_for_timeout(int(secs * 1000))


async def main():
    global T0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": W, "height": H}, record_video_dir=str(RAW), record_video_size={"width": W, "height": H})
        await ctx.add_init_script(init_script(RPC, DEP, "B"))
        page = await ctx.new_page()
        T0 = time.monotonic()

        # 1 — title + problem
        await slide(page, 1, "Veridom Build Fund — a new module of Veridom, a live house-building app (veridom.space)", 5)
        await slide(page, 2, "Building a house: owner and builder don’t trust each other, BTC holders sell, the budget sits idle", 6)

        # 2 — app overview
        await page.goto(URL + "#/")
        await page.wait_for_timeout(1500)
        await cap(page, "Borrow MUSD against your BTC, lock the build budget in escrow, pay the builder stage by stage")
        await page.wait_for_timeout(3000)
        await page.mouse.wheel(0, 520)
        await cap(page, "Built on real Mezo testnet contracts: MUSD, troves, the Savings Rate vault and the MUSD/BTC pool")
        await page.wait_for_timeout(3500)

        # 3 — homeowner creates a build fund
        await page.goto(URL + "#/new")
        await page.wait_for_timeout(1200)
        await cap(page, "The homeowner picks a payment plan — here the Austrian BTVG Ratenplan B with 2 % retention")
        await page.get_by_label("Total budget (MUSD)").fill("1000")
        await page.get_by_label("Project title").fill("Single-family house · Lower Austria")
        await page.get_by_label("Contractor wallet").fill(addr["contractor"])
        await page.get_by_label("Independent inspector (optional)").fill(addr["inspector"])
        await page.get_by_label("Arbiter for disputes").fill(addr["deployer"])
        await page.wait_for_timeout(1200)
        await cap(page, "Contractor, independent inspector and arbiter are set — one escrow contract per house")
        await tx(page, lambda: page.get_by_role("button", name="Create build fund on Mezo").click(), "create")
        await page.wait_for_url("**/#/p/0x*")
        await page.wait_for_timeout(2500)

        # 4 — contractor accepts
        await role(page, "Contractor")
        await cap(page, "The contractor accepts the plan on-chain")
        await tx(page, lambda: page.get_by_role("button", name="Accept payment plan").click(), "accept")

        # 5 — homeowner borrows against BTC straight into escrow
        await role(page, "Homeowner")
        await cap(page, "No savings in MUSD? Borrow against BTC. The app previews the loan health before the draw")
        fund = page.locator("section.card", has=page.get_by_role("heading", name="Fund the build"))
        await fund.scroll_into_view_if_needed()
        await page.wait_for_timeout(3500)
        await cap(page, "One EIP-712 signature: Mezo mints MUSD from her trove directly into the escrow")
        await tx(page, lambda: fund.get_by_role("button", name="Sign & borrow into escrow").click(), "draw")
        await cap(page, "Funded. Waiting money sits in the MUSD Savings Rate vault and earns yield for the homeowner")
        await page.locator("section.card", has=page.get_by_role("heading", name="Savings yield on waiting money")).scroll_into_view_if_needed()
        await page.wait_for_timeout(2500)
        await tx(page, lambda: page.get_by_role("button", name="Harvest yield").click(), "harvest")

        # 6 — stage 1: report → inspect → approve → pay
        await page.evaluate("window.scrollTo({top: 0, behavior: 'smooth'})")
        await role(page, "Contractor")
        stage1 = page.locator(".stage").first
        await stage1.scroll_into_view_if_needed()
        await cap(page, "Stage 1 is done. The contractor reports it with the Veridom checkpoint (photos + sign-off)")
        await tx(page, lambda: note_action(page, stage1, "Report stage done", "veridom.space/checkpoint/1042"), "request")
        await role(page, "Inspector")
        await cap(page, "An independent inspector checks the site — no payment without this sign-off")
        await tx(page, lambda: note_action(page, stage1, "Pass inspection", "ZT report 2026-11-14"), "inspect")
        await role(page, "Homeowner")
        await cap(page, "The homeowner approves. If she stayed silent, the stage would be accepted after the review window")
        await tx(page, lambda: stage1.get_by_role("button", name="Approve stage").click(), "approve")
        await role(page, "Contractor")
        if LOCAL:
            await cap(page, "The contractor claims the payment, minus 2 % retention held for the warranty")
            await tx(page, lambda: stage1.get_by_role("button", name="Claim", exact=False).first.click(), "claim")
        else:
            await cap(page, "The contractor can take the payment in BTC — swapped through the Mezo MUSD/BTC pool")
            await page.wait_for_timeout(1500)
            await tx(page, lambda: stage1.get_by_role("button", name="Take it in BTC", exact=False).click(), "claim-btc")
        await page.wait_for_timeout(1000)
        await page.locator("section.card", has=page.get_by_role("heading", name="On-chain activity")).scroll_into_view_if_needed()
        await cap(page, "Every step is an on-chain transaction" + (" (this recording: local fork of Mezo testnet)" if LOCAL else " on Mezo testnet, linked to the explorer"))
        await page.wait_for_timeout(3500)

        # 7 — finished project: disputes, retention, repay loan
        A = run["projects"].get("A")
        if A:
            await page.goto(URL + f"#/p/{A}")
            await page.wait_for_timeout(4000)
            await cap(page, "A finished project: a defect, a dispute split by the arbiter, a retention claim — all on-chain")
            await page.wait_for_timeout(3500)
            await page.locator("section.card", has=page.get_by_role("heading", name="On-chain activity")).scroll_into_view_if_needed()
            await cap(page, "And the unused budget paid down the homeowner’s BTC loan with a RepayMUSD signature")
            await page.wait_for_timeout(4000)

        # 8 — depth, engineering, business, close
        await slide(page, 5, "Eight touch-points with Mezo: borrowing, signatures, Savings Rate vault, PCV and the DEX", 6)
        await slide(page, 8, "Unit, invariant and fork tests against the real Mezo contracts. Ownerless, no admin keys", 6)
        await slide(page, 9, "Veridom is a live house-building app — Build Fund turns its checkpoint sign-offs into payments", 6)
        await slide(page, 10, "Next: Mezo Passport for Bitcoin wallets, a real pilot build, then audit and mainnet", 5)
        await slide(page, 1, "Veridom Build Fund — build your house on Bitcoin, without selling it", 4)
        await cap(page, "")
        await page.wait_for_timeout(300)
        total = now()
        video_path = await page.video.path()
        await ctx.close()
        await b.close()

    (OUT / "timeline.json").write_text(json.dumps({"total": total, "captions": timeline, "fast": fast, "raw": video_path}, indent=1))
    print(f"raw video {video_path} · {total:.1f}s · {len(fast)} wait intervals")


if __name__ == "__main__":
    asyncio.run(main())
