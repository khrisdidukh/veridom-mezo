# Veridom Build Fund — 2-minute pitch: narration script

Read at a calm pace (about 140 words per minute). Timings match the recorded demo video; the on-screen captions are a
shorter version of the same lines, so the video also works without sound.

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00 | Title slide | Hi, I’m Khrystyna, founder of Veridom — a house-building control app for private homebuilders in Austria and Ukraine. This is Veridom Build Fund, a new module built on Mezo. |
| 0:05 | Problem slide | Building a house is a year-long trust problem. Builders want money up front, owners are afraid of paying for work that isn’t done, people who saved in Bitcoin sell it to pay for the build, and the budget sits idle for months. |
| 0:12 | App overview | Build Fund fixes that: borrow MUSD against your BTC, lock the budget in an escrow, and pay the contractor stage by stage. Everything runs on the real Mezo testnet contracts — MUSD, troves, the Savings Rate vault and the MUSD/BTC pool. |
| 0:22 | New build fund | The homeowner picks a payment plan — here the Austrian BTVG instalment plan with two per cent retention — and sets the contractor, an independent inspector and an arbiter. One escrow per house, with no admin key. |
| 0:35 | Contractor accepts | The contractor accepts the plan on-chain. |
| 0:38 | Borrow against BTC | No MUSD? She borrows against her Bitcoin — only what the next stages need. One signature, and Mezo mints the MUSD straight into the escrow. The app shows her loan risk in plain words, and the guard she set blocks any draw below her limit on-chain. |
| 0:50 | Savings yield | Until each stage is paid, the money sits in the MUSD Savings Rate vault and earns protocol yield for the homeowner. |
| 0:56 | Stage 1 | When a stage is done, the contractor reports it with the Veridom checkpoint — photos and sign-off. The inspector confirms on site, the homeowner approves. If she stays silent, the stage is accepted after the review window. |
| 1:10 | Payout in BTC | The contractor can take the payment in MUSD or in Bitcoin, swapped through the Mezo pool with a slippage limit. Two per cent stays as retention for the warranty. |
| 1:18 | Activity / finished project | Every step is a Mezo transaction. In a finished project you see a defect, a dispute split by the arbiter, a warranty claim — and the unused budget paying down the homeowner’s Bitcoin loan with one signature. |
| 1:30 | Integration slide | That’s eight touch-points with Mezo: borrowing, EIP-712 signatures, the Savings Rate vault, the PCV and the DEX. |
| 1:36 | Engineering slide | The contracts are covered by unit, invariant and fork tests against the real Mezo contracts — the invariant tests even caught a real bug before launch. |
| 1:42 | Business slide | Veridom is already a live house-building app. Build Fund turns its checkpoint sign-offs into payments and brings Mezo new MUSD borrowing and long-term savings deposits. |
| 1:48 | Roadmap slide | Next: Mezo Passport for Bitcoin wallets, a pilot with a real Austrian build, then an audit and mainnet. |
| 1:54 | Title slide | Veridom Build Fund — build your house on Bitcoin, without selling it. |

## How to add your own voice

1. Record the voice-over (phone or laptop) while watching `veridom-build-fund-demo.mp4`, save it as `voice.m4a`.
2. Merge it: `ffmpeg -i veridom-build-fund-demo.mp4 -i voice.m4a -c:v copy -c:a aac -shortest demo-with-voice.mp4`
3. Upload the merged file to YouTube (unlisted is fine) and use that link in the AKINDO form.
