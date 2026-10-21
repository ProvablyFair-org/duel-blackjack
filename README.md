# Duel Blackjack — Provably Fair Audit

**Auditor:** [ProvablyFair.org](https://www.provablyfair.org) · **Audit ID:** PF-2026-DL09 · **Release:** `v1.2.0` · **Capture:** 30 April – 1 May 2026

**Result: PROVABLY FAIR — Full Pass.** All 6,000 captured hands recompute card for card from the revealed seeds, every hand's result is derived from the recomputed cards, and `amount_won` equals that derivation exactly. The verifier reports 36 passing steps of 38, two disclosed capture-origin flags and no hard failures. Step 4 records seven nonces the capture missed on retried requests; Step 37 records that the capture declined every insurance prompt, so the 2:1 insurance payout is assumed, not verified. No hand was split a second time: Duel did not offer a split on any of the 46 split hands dealt a pair again, and the capture never requested one, so whether the server refuses a re-split is not tested. Neither flag identifies an operator defect. The unfunded insurance and the untried second split are disclosed in this release and are to be covered in the next capture.

**Scope:** Single-hand Blackjack with Perfect Pairs and 21+3 side bets on Duel.com, captured from one test account: infinite deck, dealer stands on soft 17, double after split, no re-split, no surrender. The independent optimal-play engine gives **99.4296% RTP per initial bet** (99.4939% per total amount wagered) under those rules, matching the 0.57% edge a Duel staff member has stated for blackjack. Duel describes a rakeback on blackjack and a daily zero-edge limit of up to $50,000, and its config serves a stake-scaled edge; this audit tested none of them. The `effective_edge` value on each bet (0.1 on every main hand) is not applied to the hand. At the $0.01 side-bet stake captured, 30 April – 1 May 2026, the side bets paid their full multipliers with `effective_edge` 0, and at that paytable Perfect Pairs has an edge of exactly 0 and 21+3 an edge of 16/1,406,080,000,000. No other stake or date was tested: Duel's config as fetched on 5 October 2026 (E18) prices Perfect Pairs at 0.1% from the first cent (26.973 / 10.989 / 6.993 where the capture was paid 27 / 11 / 7) and ends 21+3's zero-edge tier at $0.0124 (a flush then pays 4.9995, up to $114.70). Theoretical RTP is not a promise about an individual session's return.

## What was verified

| Check | Captured evidence |
|---|---|
| Cards | 6,000 of 6,000 hands, 33,194 cursors, recomputed from server seed, client seed, nonce and cursor; 269 split rounds in the declared split order. The card code (`src/rng.ts`) was rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened Duel's code; Duel's published Verify-tab code is run as a second check (Step 38), not used as the source |
| Settlement | 6,000 of 6,000 rounds settled from the recomputed cards; the operator's label agrees on all 6,269 hands; `amount_won` exact on the 18-decimal grid |
| Side bets | 5,800 Perfect Pairs and 5,800 21+3 results recomputed and paid at the declared paytable (Phase E placed no side bets) |
| Seed records | 121 records; 120 revealed seeds hash to their commitments; 120 forward links verified |
| Rules | S17, peek, split by rank, split aces one card, DAS, double on any two and no surrender each observed with a witness count; no re-split observed only as a split never offered again (46 split hands dealt a pair, 0 offered a split; no second split requested); insurance 2:1 ASSUMED (0 of 462 prompts funded) |
| Theoretical RTP | 99.4296% per initial bet from an engine that takes no casino input, equal to an exact-rational oracle within 1e-12 |
| Observed return | 91.4309% money-path reconciliation over the capture's strategy and side-bet mix; reported separately from theoretical RTP |
| Simulation evidence | 10,000,000 Pass 1 hands (simulated RTP 99.4670%); Pass 2 Test C flags 7 of 120 seeds against a FAIL bound of 17.75 |
| Player verification | Two pinned ProvablyFair.org verifiers and Duel's own Verify-tab code (the second check) executed on all 6,000 rounds, 0 disagreements |

Hash matching and the recorded forward-commitment chain establish consistency of the captured records; they are not independent historical timestamp attestation, and a seed and commitment constructed after settlement would pass them too. That each commitment was shown before its epoch's bets rests on the capture's recorded pre-bet observations, so it holds only as far as the capture is a faithful record, which the package assumes. The missing nonces, the unfunded insurance, the untested adversarial requests and residual operator trust are recorded in the [overview's limitations](MANIFEST.md#limitations-and-trust).

## Run the audit

Extract this package and open a terminal in its directory. Use **Node 22.x**, as declared in [.nvmrc](.nvmrc) and [package.json](package.json).

```sh
npm ci
npm test
```

Expected: **the Mocha unit tests pass; `Passed: 36/38` with two capture-origin FLAGs (Steps 4 and 37); zero hard failures; `PROVABLY FAIR — Full Pass`; REPRODUCED; exit 0.** This recomputes every captured hand, checks the pinned evidence and compares fresh verification results with the committed artifacts. It scores the stored simulation and replays the Pass 2 windows; it does not regenerate the full simulation. The exit code is the verdict: `0` PROVABLY FAIR — Full Pass · `2` PROVABLY FAIR — Conditional Pass · `5` RTP FIGURE OVERSTATED (the RTP-CLAIM rule 1.2.0 found a published RTP figure above the game's real RTP; the draws pass) · `1` NOT PROVABLY FAIR, or a reproduction difference.

**RTP claim (RTP-CLAIM 1.2.0, switched on).** The main bet's exact optimal-play RTP per initial bet, 99.429612%, is held to 99.43% (the 0.57% edge a Duel staff member has stated, the figure the package cites; not one of the rule's six places). Scored on Step 16: PASS, 0.000388 pp below the figure, inside the 0.1 pp band ([table](outputs/rtp-claim-table.json)). The 0.1% in Duel's game settings is, by Duel's description, the net edge after its rakeback: noted, not tested.

```sh
npm run test:full                 # optional simulation regeneration and verification
node scripts/release-manifest.mjs --check
```

The full run took 167 seconds on the recorded machine. Ordinary runs write to `outputs/run/` and leave the evidence of record intact. See [reproduction details](MANIFEST.md#reproduce-the-audit) for the comparison rules, mutation checks, live-verifier check and deliberate artifact-refresh procedure.

## Verify a bet

Save the commitment Duel shows before you bet. After seed rotation reveals the server seed, check that SHA-256 of the hex-decoded seed equals the commitment you saved. A match is hash equality; the assurance that the seed was fixed before your hands comes from your record saved before betting, not from the match. Then use the [ProvablyFair.org verifier](https://www.provablyfair.org/verify-bets) to reproduce the cards, or follow the [complete verification instructions](MANIFEST.md#verify-a-bet), which include a short script and a captured split round to check it against. They cover seed encoding, card order, the deal and split order and the payouts.

## Files and evidence

There are two documentation files: this README and [MANIFEST.md — consolidated audit overview](MANIFEST.md). The overview contains the game rules, card algorithm, RTP calculation, verification results, evidence, limitations and release history.

- [Captured hands](data/blackjack-dataset-6000hands.json) — SHA-256 `55d4b4b1850856c8a3ecf6e59021f1f80bb3d8053376c42929e58b6733b8cae4`. The dataset carries its own paytable block.
- [Verification results](outputs/verification-results.json), [RTP claim table](outputs/rtp-claim-table.json), [simulation results](outputs/simulation-results.json), [convergence chart](outputs/rtp-convergence.html) and [release manifest](RELEASE-MANIFEST.json).
- [Audit report](https://audit.provablyfair.org/casino/duel/games/blackjack/overview) · [Public repository](https://github.com/ProvablyFair-org/duel-blackjack) · [MIT license](LICENSE).

v1.1.0's release manifest, in the copy at the `v1.1.0` tag, records the fingerprint of the ProvablyFair.org signing key (`signature`). The [release manifest](RELEASE-MANIFEST.json) in this package is v1.2.0's. The consolidation and earlier corrections are recorded in the [release history](MANIFEST.md#release-history).
