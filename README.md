# Duel Blackjack — Verifier

Independent verifier for the ProvablyFair.org audit of **Duel.com Blackjack** (with Perfect Pairs and 21+3 side bets).

- **Audit report:** https://audit.provablyfair.org/casino/duel/games/blackjack/overview
- **Audit ID:** PF-2026-DL09
- **Audited:** May 2026
- **Algorithm:** HMAC-SHA256 with rejection-sampled infinite-deck card draws (4-byte UInt32 chunks of the HMAC digest, rejected if ≥ MAX_FAIR, then `CARDS[value % 52]`)

## What's in this repo

This is the verification codebase for the Blackjack audit. It re-derives every audited primary hand AND side-bet outcome from the captured dataset, cross-validates the optimal-play RTP against the Wizard of Odds reference, and runs adversarial testing.

## Reproduce

```sh
git clone git@github.com:ProvablyFair-org/duel-blackjack.git
cd duel-blackjack
npm install
npm test
```

`npm test` runs: unit tests + 10M-hand simulation + 6,000-hand dataset verification. Expected: **PROVABLY FAIR — Full Pass**.

Individual scripts:

```sh
npm run simulate   # 10M-hand simulation (Fisher's method, 10 streams × 1M)
npm run verify     # full verification of the captured dataset + side bets
```

## Dataset

- **File:** `data/blackjack-dataset-6000hands.json`
- **SHA-256:** `55d4b4b1850856c8a3ecf6e59021f1f80bb3d8053376c42929e58b6733b8cae4`
- **Hands:** 6,000 primary bets across 6 phases (A: 3,300 · B: 1,000 · C: 500 · D: 500 · E: 200 · F: 500)
- **Side bets:** 5,800 verified (Phase E placed no side bets)
- **Rules:** S17, DAS, no surrender, no re-split, infinite-deck shoe

## Release history

| Release | What changed | Verdict |
|---------|--------------|---------|
| `v1.0.0` | The original audit. | unchanged |
| `v1.0.1` | Errata: the dataset's capture metadata carried a session credential (`meta.token`) recorded by the capture script. The field is removed; no bet, seed, outcome or payout field changed, so every figure and step result is identical. The dataset hash above is re-pinned accordingly (was `ad9cdffcea2f6cf535361e2265ae0bf95bb1290b3bbf9fee70dda053d917fe12`). | unchanged |

## Rules + RTP framing

- **Optimal-play RTP (independent engine):** 99.4296%
- **Wizard of Odds cross-check:** 99.4296% (Δ 0.0000 pp — exact match for Duel's rule set)
- **Simulated RTP:** 99.4670% (within 0.04 pp of the engine — Fisher's combined p = 0.686432)

## License

MIT
