# Veridom Build Fund — build your house on Bitcoin without selling it

**A construction escrow on Mezo.** A homeowner borrows MUSD against her BTC (Mezo trove) or brings MUSD, locks the
contractor's instalment plan in an escrow, and pays stage by stage after sign-off. Money that is waiting for its stage
sits in the **MUSD Savings Rate vault (sMUSD)** and earns yield for the homeowner. The contractor can be paid in MUSD or
**in BTC through the Mezo MUSD/BTC pool**. Unused budget pays the trove back with one signature.

Build Fund is a new module of **[Veridom](https://veridom.space)**, the house-building control app for private
homebuilders in Austria and Ukraine (live MVP, no paying users yet). Veridom already records construction checkpoints
with photo sign-off; Build Fund turns that sign-off into the payment trigger.

- **Live app (Mezo testnet):** https://khrisdidukh.github.io/veridom-mezo/
- **Hackathon:** Mezo "Build with MUSD and MEZO", Wave 2 — Track 1 (DeFi: borrowing + yield) and Track 2 (Access & Distribution)
- **Status:** deployed and verified on Mezo testnet; the full lifecycle (45 transactions, four wallets) has run on chain, including a stage paid out in BTC through the Mezo pool. Testnet only — no real users, no real money, not audited.

<!-- DEPLOYMENT:START -->
## Deployment (Mezo testnet, chain 31611)

All three contracts are verified on the Mezo explorer. The deck is in [`docs/veridom-build-fund-deck.pdf`](docs/veridom-build-fund-deck.pdf).


| Contract | Address |
| --- | --- |
| BuildFundFactory | [`0x47910F0730f18764312778D3522878166b09950D`](https://explorer.test.mezo.org/address/0x47910F0730f18764312778D3522878166b09950D) |
| BuildFundEscrow (implementation) | [`0xCE6c967aEc8713d2B5C190a1B200eafF9EF2269B`](https://explorer.test.mezo.org/address/0xCE6c967aEc8713d2B5C190a1B200eafF9EF2269B) |
| BuildFundLens | [`0x3DB3E2B52d82DFf3b56A295197fAc76D6f1b1115`](https://explorer.test.mezo.org/address/0x3DB3E2B52d82DFf3b56A295197fAc76D6f1b1115) |
| Demo project A — complete lifecycle | [`0x137544Da3A5bF42e2B52EF660afdC041Cc3f16D6`](https://explorer.test.mezo.org/address/0x137544Da3A5bF42e2B52EF660afdC041Cc3f16D6) |
| Demo project B — in progress (default in the app) | [`0x7c659BF1b70bb2fbDe67DdC38C9A1Ebfd24eCAa3`](https://explorer.test.mezo.org/address/0x7c659BF1b70bb2fbDe67DdC38C9A1Ebfd24eCAa3) |

<details><summary><b>45 demo transactions</b> (full lifecycle, four wallets: homeowner, contractor, inspector, arbiter/relayer)</summary>

| # | Step | From | Tx |
| --- | --- | --- | --- |
| 1 | Gas for contractor | deployer | [0x306bfff1…](https://explorer.test.mezo.org/tx/0x306bfff1fa958ba557a565a0953ec64df05e90fd3de7e838f073eac54e21c24c) |
| 2 | Gas for inspector | deployer | [0x930ce8e1…](https://explorer.test.mezo.org/tx/0x930ce8e13e2d3ecd9857e9597e3229d5364b8284965a121e309b7822493413c5) |
| 3 | Fund homeowner with 0.0491 BTC (collateral + gas) | deployer | [0xa1c4cb64…](https://explorer.test.mezo.org/tx/0xa1c4cb643f27419528775ae1442f8984a96c07df5e2a67b707a7fad79038dc0c) |
| 4 | Homeowner opens Mezo trove: 0.0486 BTC → 1,800 MUSD | homeowner | [0x9baf13e3…](https://explorer.test.mezo.org/tx/0x9baf13e39e3f163f4a9715ecc190e93535fd3e98e0769a981d2e4af7390d3314) |
| 5 | Create build fund “Demo house A · full lifecycle (testnet)” | homeowner | [0xa37b4e97…](https://explorer.test.mezo.org/tx/0xa37b4e971a676ae19dcfb08777f27515be4fe39c80b3928f95b8428992375c8e) |
| 6 | Contractor accepts the payment plan | contractor | [0xba0c42fa…](https://explorer.test.mezo.org/tx/0xba0c42fa611c3630f71a4fdda9d81d8ee9898e954389528c5b99be3065678b38) |
| 7 | Homeowner funds 850 MUSD (EIP-2612 permit, 1 tx) | homeowner | [0x8b3bd93b…](https://explorer.test.mezo.org/tx/0x8b3bd93b6c31eb8fc6e912c0c133d0d511ec08a7bb159808cb87636ca5f82cb3) |
| 8 | Relayer submits homeowner-signed trove draw: 150 MUSD → escrow | relayer | [0xc0374571…](https://explorer.test.mezo.org/tx/0xc0374571d8673bc328cf4cefb247544f2ca5021fa064fe376d9a49e11236af2a) |
| 9 | Harvest: poke PCV distribution, pay sMUSD yield to homeowner | relayer | [0x6841dc6f…](https://explorer.test.mezo.org/tx/0x6841dc6f0aa7ee2d30871e7aa952757dcedf26c59d4f78f55571993b9f1e0f21) |
| 10 | Contractor reports stage 1 “Start of works” done | contractor | [0x853bb5ea…](https://explorer.test.mezo.org/tx/0x853bb5ea29cc1f2f0a6d2014c40011f1eb781e8a3181784b7b68017cbd25b442) |
| 11 | Homeowner approves stage 1 | homeowner | [0xfcf63435…](https://explorer.test.mezo.org/tx/0xfcf63435cf26813d97ef7db6132326fcb3c0058391425378354c159b80a18e17) |
| 12 | Inspector passes stage 1 on site | inspector | [0xf19a3a49…](https://explorer.test.mezo.org/tx/0xf19a3a496096045d996a0064bd2bb57d179ec154ed05ee70d402aa342bdc7d2b) |
| 13 | Contractor claims stage 1 in MUSD | contractor | [0x5bbcaa37…](https://explorer.test.mezo.org/tx/0x5bbcaa377a48aec36a1c08cfce731f3d544ff1131a71a5cb2e7f24cac940396b) |
| 14 | Contractor reports stage 2 “Shell & roof” done | contractor | [0x33ca9686…](https://explorer.test.mezo.org/tx/0x33ca9686c853d3d3ab884c6f4f173b9ef87e75b33e988a4203f93c8a53fa21b6) |
| 15 | Inspector passes stage 2 (homeowner stays silent) | inspector | [0x44629e3d…](https://explorer.test.mezo.org/tx/0x44629e3d98985e3e1bc69da53c9156672c1e9dcf4736a341e2c4c5b2801350c7) |
| 16 | Contractor claims stage 2 in BTC via Mezo pool (min 0.003737 BTC) | contractor | [0xce6b2ee4…](https://explorer.test.mezo.org/tx/0xce6b2ee4d8fc1fda97802b4cd99092fc164488b6e43b89565d1130ebe36e168d) |
| 17 | Contractor reports stage 3 done | contractor | [0x8f59baf4…](https://explorer.test.mezo.org/tx/0x8f59baf4de8245bd3df7858c89ccf38d79ac67bad26de88fe44651cfaa5aa108) |
| 18 | Homeowner reports defects (missing sockets) | homeowner | [0x0551babd…](https://explorer.test.mezo.org/tx/0x0551babd3fe49790386493a16fc804eae52a2c17eeb15d817a58006a4803f193) |
| 19 | Contractor re-requests after fix | contractor | [0x8bf24744…](https://explorer.test.mezo.org/tx/0x8bf2474469e2a1bbf1bc6144e32eadd503bb09b025146c6e3df42f111f87a8fe) |
| 20 | Contractor opens dispute (homeowner unresponsive) | contractor | [0xc72711ee…](https://explorer.test.mezo.org/tx/0xc72711eeeac435b8b4f374925c5ff0baad6b39c97b80fd123dca8abd75801edc) |
| 21 | Arbiter awards 180 of 200 MUSD | arbiter (Veridom mediator) | [0xddd782a3…](https://explorer.test.mezo.org/tx/0xddd782a3ea346edc5e03c1c5cded908d375efdead9868819851eb730509f48a1) |
| 22 | Contractor reports stage 4 “Facade & windows” done | contractor | [0x18efae5c…](https://explorer.test.mezo.org/tx/0x18efae5ce3b1c75cfe26ac54d0ced34291fea0dfa14cad796324daf4088e4394) |
| 23 | Homeowner approves stage 4 | homeowner | [0x71f97ee4…](https://explorer.test.mezo.org/tx/0x71f97ee458a9de56f64342576b6f9eef6d531b3bd247c744144fe798f985ce74) |
| 24 | Inspector passes stage 4 on site | inspector | [0xd720bdfb…](https://explorer.test.mezo.org/tx/0xd720bdfb161778a0f219778e9056d5648e04471e4a792fb94795b6f1e97013bf) |
| 25 | Contractor claims stage 4 in MUSD | contractor | [0xd6d9ac80…](https://explorer.test.mezo.org/tx/0xd6d9ac800efd300ed1d841cacb7fe8fb9254691bf072244d788bb25404d27e86) |
| 26 | Contractor reports stage 5 “Ready to move in” done | contractor | [0x97b0728f…](https://explorer.test.mezo.org/tx/0x97b0728fc52a3b351f4dfa0e21d61d5450a5c572cdcdfb395e079fbb6881fbd0) |
| 27 | Homeowner approves stage 5 | homeowner | [0x089e677d…](https://explorer.test.mezo.org/tx/0x089e677de9b86ca3598bd0b04ee5480b1862fcd86579e35bd8904974be19bf28) |
| 28 | Inspector passes stage 5 on site | inspector | [0x92f0d8e5…](https://explorer.test.mezo.org/tx/0x92f0d8e50e9ea7b8bb924bd5328262d5bdca33f6117d3cae4166a7c09f27d9a8) |
| 29 | Contractor claims stage 5 in MUSD | contractor | [0xd7d98b46…](https://explorer.test.mezo.org/tx/0xd7d98b46aa695317d429179961aa6e113a287bc793145eaf700431beb1081e44) |
| 30 | Contractor reports stage 6 “Completion” done | contractor | [0xb0bd4d44…](https://explorer.test.mezo.org/tx/0xb0bd4d44c0f7a073bd8852a3937e2c00dc1393023a5f7cfb6c7cb67a779e9c0b) |
| 31 | Homeowner approves stage 6 | homeowner | [0x1d1429d2…](https://explorer.test.mezo.org/tx/0x1d1429d20fe575f48b85774e39baf5372a1fc229c07e2e04aa007b08afc3295d) |
| 32 | Inspector passes stage 6 on site | inspector | [0xe3a95fb5…](https://explorer.test.mezo.org/tx/0xe3a95fb5337a3087e3e1a273056fda2436f25e8db8eca343c6b640da8cefee8c) |
| 33 | Contractor claims stage 6 in MUSD | contractor | [0x5e5d4601…](https://explorer.test.mezo.org/tx/0x5e5d46011fb044eb46bdfa9ec3cfcbd3ec30936ee3ea14dea62dad205b434f7d) |
| 34 | Homeowner flags a warranty defect on the retention | homeowner | [0x5701617b…](https://explorer.test.mezo.org/tx/0x5701617b809cfa379460e7d02e35bc66e6b0664e249528509f37ee3bb723d693) |
| 35 | Arbiter releases 10 MUSD of retention to contractor | arbiter (Veridom mediator) | [0xb11ef04c…](https://explorer.test.mezo.org/tx/0xb11ef04cf15f49117a9a806f7af47c30f1ee9aad2483fac9dd2b8985a05ab1f8) |
| 36 | Unused 29.6 MUSD repays the homeowner’s trove (RepayMUSD sig) | homeowner | [0xb1aef1f7…](https://explorer.test.mezo.org/tx/0xb1aef1f7268863facb922f15bcf80ef6baca4785abd9fe939249838ef389f2c8) |
| 37 | Create build fund “Family home, Waldviertel (testnet demo)” | homeowner | [0xc7fc7dbf…](https://explorer.test.mezo.org/tx/0xc7fc7dbfe248ab3698d6751b11e89102dc9c67d2d928770f53d3506cac632189) |
| 38 | Contractor accepts the payment plan | contractor | [0x8064354c…](https://explorer.test.mezo.org/tx/0x8064354c247aa3be707d2f320d0f572e5442b7fa53709d3adc3c5bb11a20b3b9) |
| 39 | Homeowner funds 600 MUSD | homeowner | [0x96ae86eb…](https://explorer.test.mezo.org/tx/0x96ae86eba3ffd01a5144fe2330e0e077fe424ccf20b4c99a66ae6f1ba14efa14) |
| 40 | Contractor reports stage 1 “Foundation slab” done | contractor | [0xe78d7422…](https://explorer.test.mezo.org/tx/0xe78d742218e0dd97ad428322ced1cf6a7a1285cd08b3f8a840bbc32f15a1bcfd) |
| 41 | Homeowner approves stage 1 | homeowner | [0xa2753ff2…](https://explorer.test.mezo.org/tx/0xa2753ff2cb97f3ae6670e189f93ec1af5ca6b763e5763a07c69a1ec5006cc040) |
| 42 | Inspector passes stage 1 on site | inspector | [0x292c83e4…](https://explorer.test.mezo.org/tx/0x292c83e44b1374b938c160abe08aa4ed7b137b986f693985750ff9dcf1fc2772) |
| 43 | Contractor claims stage 1 in MUSD | contractor | [0x6ac12d8e…](https://explorer.test.mezo.org/tx/0x6ac12d8e1019b22d83ae433278b7447109486bf1de8ea5e80c22b333741e1a38) |
| 44 | Contractor reports stage 2 “Walls” done | contractor | [0x0770d7f8…](https://explorer.test.mezo.org/tx/0x0770d7f86ab7d9fbe376d7f23a70143a2b96cfd6003a2ade018b720c0abcb666) |
| 45 | Inspector passes stage 2 | inspector | [0xdfec89be…](https://explorer.test.mezo.org/tx/0xdfec89be0dd1a6d448e23c3b48cb558925baffdbaaf6a555bdbf8907a4bbcfae) |

</details>
<!-- DEPLOYMENT:END -->

## Why

| Who | Pain today | With Build Fund |
| --- | --- | --- |
| Homeowner | Pays instalments up front and hopes the work matches; sells BTC to fund the build | Pays only after sign-off; borrows against BTC instead of selling; earns yield on the waiting budget |
| Contractor | Chases payments; no proof the client can pay the next stage | Sees every stage funded on-chain; silence counts as acceptance after the review window; can take BTC |
| Inspector / mediator | Paper reports nobody enforces | Their sign-off or decision moves money directly |

The stage plans follow familiar practice: the Austrian **BTVG Ratenplan B** (10 / 30 / 20 / 12 / 17 / 9 % with 2 %
retention for three years), the German **MaBV §3** instalments, or a generic five-stage plan. Templates are starting
points, not legal advice. (BTVG binds property developers; for a private build with your own contractor it is the
reference plan, but nothing enforces it — which is the gap this contract fills.)

## How it works

```
 Homeowner BTC ──openTrove──▶ Mezo trove
                                  │ WithdrawMUSD signature (recipient = escrow)
                                  ▼
 MUSD (permit) ──fund──▶  BuildFundEscrow  ──deposit/withdraw──▶ MUSD Savings Rate (sMUSD)
                          stages, sign-offs,        ▲                 │ yield ─▶ homeowner
                          deadlines, disputes,      └─ harvest() pokes PCV.distributeMUSD()
                          retention, draw guard
                                  │ claim()
                                  ├──▶ contractor in MUSD
                                  └──▶ Mezo Router MUSD→BTC (min-out) ──▶ contractor in BTC
 free balance ──RepayMUSD signature──▶ burns against the homeowner's trove debt
```

**Stage lifecycle** — `Pending → Requested → (Approved | Rejected | Disputed) → Paid / Cancelled`

1. Contractor `acceptProject()` (signs the plan), then `requestRelease(stage, evidenceHash)` with the hash of the
   Veridom checkpoint record (photos, measurements, both-party signatures).
2. Homeowner `approve()`; the independent inspector (optional per project) `inspect(pass|fail)`.
3. Payable when both required sign-offs exist — **or** when the review window has passed without the homeowner
   rejecting or disputing (the inspector sign-off is still required if an inspector is configured).
4. Homeowner can `reject()` inside the window (contractor fixes and re-requests) or either side can `dispute()`;
   the arbiter `resolveDispute(stage, toContractor)` and the rest returns to the homeowner's free balance.
5. After a stage's deadline, an undelivered stage can be `cancelStage()`d by the homeowner.
6. Every payment withholds the retention (e.g. 2 %), ring-fenced until `completedAt + warrantyPeriod`; the homeowner
   can release early or `disputeRetention()` for warranty defects; the arbiter splits it.

**Money in:** `fund()`, `fundWithPermit()` (EIP-2612, one transaction), or `drawFromTrove()` — the homeowner signs a
Mezo `WithdrawMUSD` EIP-712 message with `recipient = escrow`, so **anyone can relay it** (e.g. Veridom's backend or
the contractor) and the MUSD can only land in this escrow. A **draw guard** (`minIcrAfterDraw`, e.g. 150 %) set by the
homeowner makes the draw revert if her trove would end up below that collateral ratio.

**Money out:** `claim(stage, MUSD|BTC, minOut)`, `withdrawFree()`, `repayTroveFromFree()` (Mezo `RepayMUSD`
signature; the escrow is the payer), `releaseRetention()`.

**Yield:** all idle MUSD is deposited in the MUSD Savings Rate vault. `harvest()` is permissionless: it first calls the
permissionless `PCV.distributeMUSD()` so freshly accrued protocol fees reach the vault, then claims the escrow's
yield and sends it to the homeowner. Yield that the vault pays out together with a withdrawal is also forwarded to the
homeowner, so it can never be mistaken for principal.

**No admin.** Factory and escrows are ownerless and not upgradeable. Each project is an EIP-1167 clone.

## Mezo integration (all real testnet contracts)

| Mezo contract | Address (chain 31611) | Used for |
| --- | --- | --- |
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | settlement token, EIP-2612 permit |
| BorrowerOperations | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | `openTrove` from the web app (HintHelpers + SortedTroves hints) |
| BorrowerOperationsSignatures | `0xD757e3646AF370b15f32EB557F0F8380Df7D639e` | `withdrawMUSDWithSignature` → escrow; `repayMUSDWithSignature` from escrow |
| TroveManager | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | ICR for the draw guard; lens (debt, coll, interest, TCR) |
| PriceFeed | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | BTC price for ICR and liquidation price |
| HintHelpers / SortedTroves | `0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6` / `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | insert hints |
| MUSD Savings Rate (sMUSD) | `0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16` | idle budget, yield |
| PCV | `0x4dDD70f4C603b6089c07875Be02fEdFD626b80Af` | `distributeMUSD()` before harvesting |
| Router / PoolFactory (basic pools) | `0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9` / `0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A` | contractor payout MUSD→BTC |

**About the Savings Vault on testnet.** The vault address in the docs (`0xb4D4…51CC`) is the **mainnet** vault and has
no code on chain 31611. The testnet vault exists: it is the PCV's `feeRecipient()`, a verified `MUSDSavingsRate`
contract ("MUSD Savings Rate", symbol sMUSD). It is **not ERC-4626** — deposits mint sMUSD 1:1 and yield is tracked by a
global `yieldIndex` and paid in MUSD via `claimYield()` (and on `withdraw()`). The escrow integrates exactly that
interface (`src/interfaces/IMezo.sol`) and keeps `principal == sMUSD balance` as an invariant.

## Repository

```
contracts/                Foundry project
  src/BuildFundEscrow.sol   per-project escrow (clone)
  src/BuildFundFactory.sol  ownerless factory + registry
  src/BuildFundLens.sol     trove health view (ICR, liquidation price, after-draw preview)
  src/interfaces/IMezo.sol  Mezo interfaces, checked against verified sources
  script/Deploy.s.sol       deployment; script/MezoTestnet.sol addresses
  test/                     unit, invariant and fork tests
web/                      React + viem app (GitHub Pages)
  scripts/onchain-demo.mjs  full lifecycle on testnet with four wallets
media/                    deck + demo video tooling (Playwright, ffmpeg)
```

## Tests

```bash
cd contracts
forge test --no-match-path "test/fork/*"                                   # 49 unit + 3 invariant tests
forge test --match-path "test/fork/*" --fork-url https://rpc.test.mezo.org  # 3 fork tests on real Mezo contracts
```

- **Unit (49):** creation validation, permit funding, full build with retention, two-key sign-off, silence-is-acceptance
  (with and without inspector), reject → fix → re-request, inspector fail, disputes (partial, zero, late), deadline
  cancellation, under-funding, ring-fenced retention, yield harvest and forwarding, signed trove draws (relay, replay,
  wrong recipient, guard), repay from free balance, BTC payout with slippage, reentrancy via a malicious router,
  access control on every restricted entry point, no BTC accepted.
- **Invariant (3, 256 runs × 500 calls):** random sequences of funding, yield, requests, sign-offs, claims, disputes,
  deadlines, cancellations, withdrawals and retention releases. Invariants: sMUSD balance == tracked principal and no
  MUSD stranded; money conserved (`funded = principal + paid + withdrawn + repaid`); commitments consistent.
  *This suite found a real bug during development:* when a project was under-funded, already-withheld retention could
  be used to pay a later stage. Fixed (`_spendable()` excludes retention) and covered by a regression test.
- **Fork (3):** against the real testnet contracts — a real trove is opened, an EIP-712 `WithdrawMUSD` signature mints
  into the escrow (and the guard blocks a risky second draw), real Savings Rate yield is harvested from the real PCV,
  the deemed-acceptance path pays out, and a `RepayMUSD` signature burns leftover budget against the trove. The fork
  run also revealed that Mezo's ActivePool pings the draw recipient with a zero-value call, so the escrow has a
  `receive()` that accepts only zero value.
  *Fork limitation:* Mezo's BTC/USD oracle and the BTC token are chain precompiles that a local EVM cannot execute;
  the fork test mocks the oracle with the live price, and the BTC payout path is exercised on the real testnet by
  `web/scripts/onchain-demo.mjs` instead.

## Run it

```bash
# contracts
cd contracts && forge build && forge test

# deploy to Mezo testnet (key in an env var or file you control)
PRIVATE_KEY=0x... forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast

# web app
cd web && npm install && node ../scripts/export-abi.mjs && npm run dev

# full on-chain lifecycle with four wallets (keys in ./keys/*.key, gitignored)
cd web && node scripts/onchain-demo.mjs
```

A local fork for offline demos: `scripts/local-fork.sh` (anvil + a stand-in for the oracle precompile).

## Security notes and known limits

- Not audited. Testnet only.
- Trust assumptions: the arbiter decides disputes; the inspector can block payment by not signing (the contractor can
  then dispute). Both are chosen per project by the homeowner and accepted by the contractor on-chain.
- BTC payout uses the pool price with a contractor-chosen `minOut`; the app suggests 1 % below the live quote.
- The draw guard reads Mezo's oracle price at draw time; it protects against drawing too much, not against later BTC
  price drops (the app shows the liquidation price and how far BTC can fall).
- Evidence and notes are stored as hashes; the documents themselves live in Veridom.
- Stage amounts are fixed at creation; change orders (Nachträge) are a planned feature.

## Roadmap

1. **Wave 3:** Mezo Passport so homeowners can connect a Bitcoin wallet; Veridom checkpoints write the evidence hash automatically.
2. **Pilot:** one Austrian renovation on testnet with a real contractor and inspector; contractor onboarding.
3. **Before mainnet:** third-party audit, legal review of the escrow under Austrian law, launch inside Veridom.

## Team

Khrystyna Didukh (Vienna) — founder of Veridom; co-founder & CTO of Avara Bio; ran the exotic-flower import business 358
for ten years and built its web shops, apps and CRM; three years at PwC; Estonia e-Residency Envoy; UNDP Woman Innovator.

Licence: MIT.
