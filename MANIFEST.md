# Manifest — Duel Blackjack Audit

- **Audit ID:** PF-2026-DL09
- **Publication date:** 4 June 2026
- **Audit report:** https://audit.provablyfair.org/casino/duel/games/blackjack/overview
- **Auditor:** ProvablyFair.org
- **Audit date:** May 2026
- **Game variant:** Standard Blackjack with Perfect Pairs and 21+3 side bets
- **Rules:** S17 (dealer stands on soft 17), DAS (double after split), no surrender, no re-split, infinite-deck shoe

## Algorithm

HMAC-SHA256-driven rejection-sampled infinite-deck card draws. Each card consumes one HMAC call; the digest is scanned in 4-byte UInt32 chunks until a value below `MAX_FAIR = 52 * floor(2^32 / 52)` is found, then mapped to `CARDS[value % 52]`. The rejection step removes the modulo bias that a direct `% 52` on a 32-bit value would introduce.

```
cursor = 0
for each card:
    message = clientSeed + ":" + nonce + ":" + cursor
    hash    = HMAC-SHA256(serverSeed, message)
    for each 4-byte chunk of hash:
        value = chunk as UInt32 (big-endian)
        if value < MAX_FAIR:        # rejection sampling — removes modulo bias
            return CARDS[value % 52]
    cursor += 1
```

Side bets (Perfect Pairs, 21+3) are evaluated against the initial 3-card snapshot (player's two + dealer's up-card) per the published pay tables.

## Dataset

- **File:** `data/blackjack-dataset-6000hands.json`
- **SHA-256:** `55d4b4b1850856c8a3ecf6e59021f1f80bb3d8053376c42929e58b6733b8cae4`
- **Primary bets:** 6,000
- **Side bets:** 5,800 (Phase E placed no side bets)
- **Seed entries:** 121 (120 used + 1 forward commitment after final rotation)
- **Phases:**
  - A — 3,300 hands — baseline coverage
  - B — 1,000 hands — high-variance
  - C — 500 hands — bet-size invariance
  - D — 500 hands — client seed variation
  - E — 200 hands — primary only (no side bets)
  - F — 500 hands — additional configuration coverage

## Verification

- **Hands verified:** 6,000 / 6,000 — 0 mismatches
- **Side bet recomputation:** 5,800 / 5,800 — 0 mismatches
- **Optimal-play RTP (independent engine):** 99.4296%
- **Wizard of Odds cross-check:** 99.4296% — Δ 0.0000 pp (within 0.02 pp tolerance)
- **Simulated RTP:** 99.4670% (within 0.04 pp of the engine)
- **Simulation Pass 1:** 10,000,000 hands (10 streams × 1,000,000) — Fisher's combined p = 0.686432
- **Simulation Pass 2 (cherry-pick test):** 120 casino seeds × 10,000 nonces — 11 flagged, binomial p = 0.038450 (marginal — see multi-window analysis in `tests/verify.ts`)
- **Serial independence fails (simulation):** 0

## Reproducibility

Cloning this repo at the publication commit and running `npm install && npm test` reproduces the entire audit pipeline. The dataset hash is verified at startup; the verifier recomputes every hand AND every side-bet evaluation from `(serverSeed, clientSeed, nonce, cursor)`; the optimal-play RTP is independently computed (no operator-supplied data); the result is cross-validated against the Wizard of Odds reference for the same rule set.
