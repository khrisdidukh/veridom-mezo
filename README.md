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
- **Status:** testnet only. No real users, no real money. Not audited.

<!-- DEPLOYMENT:START -->
_Deployment details are filled in by `scripts/update-readme.mjs` after the testnet run._
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
forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --private-key "$PRIVATE_KEY"

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
