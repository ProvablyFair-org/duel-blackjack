# Duel Blackjack — Consolidated Audit Overview

**Audit ID:** PF-2026-DL09 · **Auditor:** ProvablyFair.org · **Release:** `v1.2.0` · **Framework:** 1.1 (Blackjack profile 1.0.2)

Original audit: May 2026. Capture: 30 April – 1 May 2026, from `2026-04-30T21:31:22.265Z` to `2026-05-01T13:16:57.939Z`. Original publication: 4 June 2026. Audit report: https://audit.provablyfair.org/casino/duel/games/blackjack/overview. This overview consolidates the package documentation. The machine-readable release identity remains in [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json).

## Conclusion and scope

**PROVABLY FAIR — Full Pass:** 36 of 38 scored steps pass, two are capture-origin flags and there are no hard fails. Step 4 records seven nonces the capture missed on a retried request, each under a revealed, commitment-checked seed; the missing hands were not captured and are not verified. Step 37 records that the capture declined every insurance prompt, so the 2:1 insurance payout is assumed, not verified. No hand was split a second time either: Duel offered no split on any of the 46 split hands dealt a pair again, and the capture never requested one (R-RESPLIT). The unfunded insurance and the untried second split are disclosed in this release and are to be covered in the next capture. The two flags (Steps 4 and 37) are disclosed and verdict-neutral: a capture-origin flag records a limit of the auditor's capture, not anything the operator served, which is why the result is a Full Pass rather than a Conditional Pass.

The commit-reveal chain is intact across 120 epochs. Every card in 6,000 captured hands recomputes from the revealed seeds at its declared cursor, every hand's result is derived from the recomputed cards, and `amount_won` equals that derivation exactly. At the $0.01 side-bet stake captured, both side bets were paid the published multipliers. Three independent RTP estimates agree: the audit's optimal-play engine, an exact-rational oracle (to 1e-12) and a 10-million-hand simulation (within 0.04 percentage points). The engine also reproduces two dated Wizard of Odds pages under those pages' own (re-splitting) rules.

**Scope.** Single-hand Blackjack against the dealer with Perfect Pairs (perfect / coloured / mixed) and 21+3 (suited trips / straight flush / three of a kind / straight / flush) side bets, on Duel.com, from a single ProvablyFair.org test account funded by ProvablyFair.org. The rules are infinite deck, dealer stands on soft 17 (S17), double after split (DAS), no re-split and no surrender. The same rules settled the hands at both captured main-bet stakes, $0.01 and $10 (Step 9); no other stake was tested. At the captured stakes ($0.01 and $10 main bets, $0.01 side bets), 30 April – 1 May 2026, the main hand paid standard odds and the side bets their full multipliers; the capture wagered $2,440.12, under the daily zero-edge limit of up to $50,000 that Duel states (E19). Duel's config as fetched on 5 October 2026 (E18) serves a stake-scaled edge whose first Perfect Pairs tier is not what the capture was paid ([Duel's edge model](#duels-edge-model)).

**Optimal-play RTP (independent engine): 99.4296% (S17, DAS, no surrender, no re-split, infinite deck)** per initial bet, 0.5704% house edge; 99.4939% per total amount wagered. This matches the 0.57% edge a Duel staff member has stated for blackjack (E19). At the $0.01 side-bet stake captured, 30 April – 1 May 2026, the side bets paid their full multipliers with `effective_edge` 0, and at that paytable Perfect Pairs has an edge of exactly 0 and 21+3 an edge of 16/1,406,080,000,000; no other stake or date was tested, and E18 prices Perfect Pairs at 0.1% from the first cent and 21+3 above zero edge from $0.0124 ([Duel's edge model](#duels-edge-model)). Theoretical RTP is not a promise about an individual session's return.

The audit does not establish anything about other Duel games (audited separately), about rule sets that would change the engine's inputs (a finite-deck shoe, for example), about cross-account behaviour (R-MULTI), or about a later change to the commitment, rotation or RNG algorithm. It describes the platform as observed during the capture; the commit-reveal protocol gives a later audit the means to detect a silent change.

## Contents

- [Dataset and capture](#dataset-and-capture)
- [Game and algorithm](#game-and-algorithm)
- [Payouts and RTP](#payouts-and-rtp)
- [Verification results](#verification-results)
- [Reproduce the audit](#reproduce-the-audit)
- [Verify a bet](#verify-a-bet)
- [Evidence](#evidence)
- [Limitations and trust](#limitations-and-trust)
- [Terms](#terms)
- [Release history](#release-history)

## Dataset and capture

The 6,000 hands were recorded through a browser session against the live Duel.com blackjack endpoints. [The capture reference](capture/capture.reference.js) records the capture script's method: 6 phases, per-hand decision logic and seed rotation; it is a reference record, not a runnable tool. The script authenticated with the standard Duel session cookie, requested a security token at start-up (valid for about 10 minutes, refreshed whenever a token-expired error came back), placed hands one at a time through the deal / hit / stand / double / split / insurance endpoints in `balance_type = 105` (fiat USD), and recorded each deal and action response. It requested an explicit rotation at every phase boundary and after every 50 hands. The plaintext `serverSeed` on each seed record and `server_seed` on each bet are not part of those recorded responses: on 1 May 2026, after the final rotation had closed every epoch and after the capture script's save, a separate post-capture step run by ProvablyFair.org read each bet's revealed `server_seed` from Duel's transaction records and wrote it onto the bet and onto the seed record carrying that bet's commitment. That step's code was not kept. The dataset's layout is not the one the capture reference's rotation code (lines 435–451) writes, which puts each revealed seed on the next epoch's record.

| Phase | Hands | Main stake | Side bets | Capture strategy | Initially wagered |
|---|---:|---:|---|---|---:|
| A | 3,300 | $0.01 | PP $0.01 + 21+3 $0.01 | Basic strategy | $99.00 |
| B | 1,000 | $0.01 | PP + 21+3 | Aggressive (hit to 16+) | $30.00 |
| C | 500 | $0.01 | PP + 21+3 | Split / double priority | $15.00 |
| D | 500 | $0.01 | PP + 21+3 | Basic strategy; 10 auditor client seeds × 50 hands | $15.00 |
| E | 200 | $10.00 | none | Basic strategy | $2,000.00 |
| F | 500 | $0.01 | PP + 21+3 | Multi-split focus (forced split, as C) | $15.00 |
| Total | 6,000 | | 5,800 side-bet hands | | $2,174.00 |

Phase B exercises hit-cursor allocation across more cursors per hand, C and F exercise split cursor order and DAS, D exercises player-chosen client seeds (Step 15) and E checks that the cards do not depend on stake (Step 9). The population of record (6,000 hands, 121 seed records, 50 per epoch and the per-phase counts) is pinned as code constants in `src/loader.ts` and scored by Step 13; a dataset that agrees with its own header but not with the plan hard-fails. The 121 seed records are 120 used and revealed epochs of exactly 50 bets plus one forward commitment after the final rotation, which the dataset does not reveal: a rotation after the capture ended made it the active commitment shown in E05, and its seed was not recorded. The capture script requested every rotation (`doRotation` in the capture reference): six at phase boundaries and 114 within phases after each 50-bet epoch give the 120 transitions, and one final rotation follows the last epoch. Each seed record holds one rotation response's client seed, commitment and next commitment, timestamped (`at`) when the capture recorded it; its `serverSeed` was attached after the capture, as described above.

**Client seeds.** Phases A, B, C, E and F used 110 distinct `pf_` + 13-character seeds that the capture script generated with `Math.random()`, not a CSPRNG (DL-2). Phase D used the ten fixed, predictable strings `pfaudit_bj_seed00` … `pfaudit_bj_seed09`, one per epoch. The site's own default client seed is a different thing: E13 shows it drawn in the browser with rejection-sampled `crypto.getRandomValues`; the capture did not use it.

**Capture-time strategy.** The capture script played each hand with one of three deterministic strategies (basic, aggressive, split-and-double-priority) chosen per phase. A post-capture comparison found that this capture-time strategy diverges from optimal play on a subset of decisions. No verification claim depends on it: every card recomputes from `(serverSeed, clientSeed, nonce, cursor)` whatever the player chose (Steps 5, 22), every payout reconciles from the resulting cards whether or not the action was optimal (Steps 7, 21, 24, 26), and the RTP claim comes from `src/optimal-play.ts` and `src/simulate.ts`, which match each other on every decision and do not read the capture strategy.

| Input | Identity |
|---|---|
| [data/blackjack-dataset-6000hands.json](data/blackjack-dataset-6000hands.json) | SHA-256 `55d4b4b1850856c8a3ecf6e59021f1f80bb3d8053376c42929e58b6733b8cae4` |

The dataset carries its own `config.multipliers` block (the side-bet multipliers), and no step reads a separate configuration file. The capture script, which is not shipped (the release carries capture tools as reference copies only, and [the capture reference](capture/capture.reference.js) records its method), writes that block from constants when it saves the dataset, so it is the declared paytable, not a recorded response; the multipliers Duel served are the ones on each side-bet result, which Step 8 checks. The block's eight entries equal the `multipliers` object in E18, Duel's config as fetched from duel.com on 5 October 2026 in a logged-in session (read-only GET), which no step reads. The SHA-256 is pinned in `src/loader.ts` (`EXPECTED_HASH`), checked before any step runs and again by Step 14, which also requires the config block to equal the declared paytable in `src/config.ts` (8/8 entries).

## Game and algorithm

### Rules

One player plays against the dealer, with three betting circles per hand: the main bet, Perfect Pairs (on the player's first two cards) and 21+3 (on those two cards plus the dealer's up-card). A hand wagering all three puts `main + PP + 21+3` down at the deal, $0.03 at the $0.01 stake. The deal response lists the legal moves in `available_actions`:

| Action | Endpoint | Meaning |
|---|---|---|
| deal | `POST /api/v2/blackjack` | Main wager, optional PP and 21+3 stakes and the security token; returns P1, dealer up-card and P2 with the hole card face down |
| `hit` / `stand` | `POST /api/v2/blackjack/{id}/hit`, `/stand` | One more card; end the player turn and let the dealer play |
| `double` | `POST /api/v2/blackjack/{id}/double` | Double the stake, exactly one more card, forced stand |
| `split` | `POST /api/v2/blackjack/{id}/split` | Split a pair of the same rank into two hands |
| `insurance` / `no_insurance` | `POST /api/v2/blackjack/{id}/insurance` | On a dealer Ace, optionally bet up to half the main wager that the dealer has blackjack |

The capture also used `POST /api/v2/user/security/token`, `POST /api/v2/client-seed/rotate` (reveals the active server seed and commits the next one) and `GET /api/v2/user/transactions/{txId}` (the revealed `serverSeed` of past bets). No endpoint changes house rules or previews unrevealed state; the only randomness-affecting operation a player can perform is the seed rotation.

Split pairs by rank, not value: 8H + 8C and Q + Q split, Q + K and J + Q do not. Split aces take exactly one card each. Non-ace split hands can hit and double. Each starting hand splits at most once. Every rule was confirmed from the captured play:

| Rule | Witness |
|---|---|
| 2 + 2 initial deal, hole card face down | 6,000/6,000 deals; 443 auto-resolved naturals reveal the hole at the deal (Step 32) |
| Infinite deck (with replacement) | Initial four cursors: 670/6,000 hands repeat a rank+suit against the infinite-deck expectation 668.2 ± 24.4 (z = 0.08; FAIL outside ±5σ; a single finite deck gives 0). Whole hand: 1,354/6,000 hands contain at least two visible cards of identical rank and suit (Step 29) |
| Actions ⊂ {hit, stand, double, split, insurance, no_insurance}; surrender never offered | 14,313/14,313 action lists, 0 unknown actions, `surrender` 0 times (Step 28) |
| Dealer plays out only when needed; stands on soft 17 | 4,216 dealer-played rounds; 1,784 exempt rounds (a natural on either side, or every hand bust) all show two dealer cards; 75/75 soft-17 cases stood, 0 hits (Step 19) |
| Double on any two cards | 1,291 rounds with a doubled hand, 1,368 doubled hands; 766 unsplit doubles on a two-card total outside 9–11 (Steps 21, 37) |
| Split by rank; DAS; one split; split aces one card | 438 split offers, 0 on a non-pair; 269 splits; 109 with DAS; 0 re-splits (46 split hands dealt a pair again, split offered after a split in 0 rounds); 34/34 ace splits ended with two cards per hand (Steps 23, 37) |
| Insurance offered if and only if the up-card is an Ace | 462/462 prompts on an Ace; 462/462 Ace-up deals prompted; `insurance_available` agrees with the up-card on 6,000/6,000 deals (Step 25) |
| Insurance pays 2:1 | **ASSUMED** — 0 of 462 prompts funded (Step 37 FLAG, DL-3) |
| Blackjack pays 3:2; natural against natural pushes | 277 naturals: 260 return 2.5×, 17 push at 1× (Step 20) |
| Push returns the stake; loss and bust return 0 | 514 push, 1,916 lose and 1,318 bust hands, each derived from the cards (Steps 7, 30) |
| Side bets resolve at the deal; side stake equals main stake | 5,800 PP and 5,800 21+3 results unchanged deal→final (Step 27); 5,800/5,800 stakes equal for each (Step 31) |
| Stake per phase | 6,000/6,000 at exactly $0.01, or $10 in Phase E (Step 33) |

Of the 28 stated rules, 27 are verified by a scored step with non-trivial evidence. The insurance payout is not verifiable from this dataset and is disclosed (DL-3).

### Card derivation

The algorithm in [src/rng.ts](src/rng.ts) is the only card generator in the package; the simulation, the verifier, the engine and the unit tests all import it. Since v1.2.0 it is rebuilt from a written specification, [docs/ALGORITHM.md](docs/ALGORITHM.md), by an implementer who never opened Duel's code. The specification was written from Duel's public pages, the standard provably-fair construction and the 6,000 captured rounds, without Duel's code; its §4 gives the source of every step and its §8 lists every file read. Duel's published Verify-tab code (E17) is run as a second check on every captured round (Step 38), not used as the source. Through v1.1.0 `src/rng.ts` was ported from that code, and a port can carry over a mistake in Duel's code that a rebuild from a specification could catch.

1. The key is the server seed hex-decoded to 32 bytes. Using the 64 hex characters as UTF-8 gives a different HMAC; Step 5 would then report 6,000 mismatches.
2. Card number `cursor` is `HMAC-SHA256(key, "<clientSeed>:<nonce>:<cursor>")`, read as eight big-endian uint32 chunks.
3. The first chunk below `MAX_FAIR = 52 × ⌊2³² / 52⌋ = 52 × 82,595,524 = 4,294,967,248` selects `CARDS[value % 52]`. `CARDS` runs 2D 2H 2S 2C 3D … AC: rank ascending, diamonds, hearts, spades, clubs within each rank.
4. If all eight chunks reject, the function throws. The specification leaves this case open (its §6 O1); the rebuild throws, and so does Duel's published code (fixed hash vector V4, Step 38).

One HMAC produces one card, so a card can repeat within a hand. The rejected range is 48 of 4,294,967,296 values (about 1.118 × 10⁻⁸). Without rejection, indices 0–47 would each have probability `82,595,525 / 2³²` and indices 48–51 `82,595,524 / 2³²`; with it, every index has probability exactly 1/52 (Step 35: bias per accepted draw exactly 0). Exhausting all eight chunks has probability 2.4e-64 per draw. None of the 33,194 captured draws rejected a chunk (3.7e-4 expected), so the rejection branch is unit-tested, not witnessed (DL-4).

**Cursor order.** Cursor 0 is the player's first card, 1 the dealer's up-card, 2 the player's second card and 3 the dealer's hole card; then the player's draws in the order taken; then the dealer's draws (`DEAL_ORDER` in `src/rng.ts`). After a split, cursor 4 is the second card of the hand built on the first card and cursor 5 the second card of the other hand; then the first hand plays out, then the second, then the dealer. Steps 5 and 22 assert this order card for card on all 269 split rounds (2,259 cursors). A hand has 50 cursors available (0–49); the longest captured hand used cursor 13. The hole card at cursor 3 is committed at the deal; face down is a presentation choice, and the recomputed cursor 3 equals the card the dealer later exposes.

**Worked example (bet 13418615, the first captured bet, Phase A, nonce 0).** Revealed server seed `b6f2cbcd411eedbd53587902410f17f43e962f2e374e97ccbec24088debd0556`, commitment `94c218c91df8997d4e7b1280687e90a3573c98739bd9220cd2fdd595699ef34f`, client seed `pf_Naa0pBEOuWmz6`.

| Cursor | HMAC message | First 8 bytes | uint32 | % 52 | Card |
|---:|---|---|---:|---:|---|
| 0 | `pf_Naa0pBEOuWmz6:0:0` | `9fa6f6bfd79a0c76` | 2,678,519,487 | 7 | 3C |
| 1 | `pf_Naa0pBEOuWmz6:0:1` | `fd30ac9732b35170` | 4,247,825,559 | 3 | 2C |
| 2 | `pf_Naa0pBEOuWmz6:0:2` | `ad860917ad76806e` | 2,911,242,519 | 3 | 2C |
| 3 | `pf_Naa0pBEOuWmz6:0:3` | `6d2f341c0b43de60` | 1,831,810,076 | 44 | KD |

The deal returned player 3C 2C and dealer 2C with the hole face down; cursor 3 gives the hole card KD, so the dealer started on 12. All four values are below `MAX_FAIR`.

### Seed lifecycle

The commitment is `SHA-256(hex_decode(serverSeed))`, shown in the deal response's `server_seed_hashed`. Every bet on that seed uses it as the HMAC key; the nonce starts at 0 for each seed and increases by one per hand, not per action. Deal and action responses carry only the active commitment. The next seed's commitment (`next_server_seed_hash`) comes back in the rotation response and is stored in each seed record as `nextServerSeedHash`. When the player rotates, the active seed is revealed and every card it produced becomes verifiable. Steps 1–3 check every revealed seed against its commitment (120/120), every forward link (120/120) and that every bet in an epoch carries that epoch's committed hash and client seed (120/120 epochs, 6,000/6,000 bets). The hash and link checks are consistency checks: they show the seed records fit together, and a seed and commitment constructed after settlement would pass them too. When each commitment was shown rests on the capture's records ([Pre-bet commitment evidence](#limitations-and-trust)). There is no public-randomness beacon: the server seed, the client seed, the nonce and the cursor are the only inputs.

Duel's own Blackjack Verify-tab code, copied from the page's code panel on 25 September 2026 as E17, is retained in [evidence/verify-tab](evidence/verify-tab/). It is not the source of `src/rng.ts`; Step 38 executes it unmodified on all 6,000 rounds as a second check. The file does not contain the commitment encoding, which rests on the capture (Step 1). Agreement with published code does not establish which code the page's Verify button or Duel's server runs.

## Payouts and RTP

### Settlement

| Outcome | Returned (× the hand's original wager) |
|---|---:|
| Loss or bust | 0 |
| Push | 1 |
| Win | 2 |
| Natural blackjack against a non-natural dealer | 2.5 |
| Natural against a dealer natural | 1 (push) |
| Doubled hand: loss / push / win | 0 / 2 / 4 |

Split hands settle independently against the dealer; a two-card 21 on a split hand settles as a total, not a natural (30/30 witnessed, Step 24). Insurance would return 3× the insurance wager when the dealer has a natural and 0 otherwise; it was never funded. Example: bet 13418934 (nonce 16) was dealt JC + AD against a dealer 10S and received `amount_won = 0.025` on a $0.01 stake.

Money is compared exactly: every amount is parsed to 1e-18 integer units and every multiplier to an exact rational (`src/money.ts`), with zero tolerance. All 82,400 money strings lie on the 18-decimal grid, and `amount_won` equals stake × main returns + side returns derived from the cards on 6,000/6,000 rounds (Step 7). Earlier versions compared after `parseFloat`, first at an absolute 1e-6, then at a relative 1e-12.

| Perfect Pairs (first match wins) | Returned | 21+3 (first match wins) | Returned |
|---|---:|---|---:|
| Perfect pair: same rank, same suit | 27× | Suited trips: same rank, same suit | 121.2307692× |
| Coloured pair: same rank and colour | 11× | Straight flush: consecutive ranks, one suit | 53× |
| Mixed pair: same rank, other colour | 7× | Three of a kind | 32× |
| No pair | 0× | Straight (Ace high or low) | 12× |
| | | Flush | 5× |

Multipliers are total returns, including the side-bet stake. Both side bets are evaluated on cursors 0, 2 and 1 (the player's two cards and the dealer's up-card); the hole card plays no part. `121.2307692` is kept at the precision Duel serves on a Suited Trips result. Step 8 re-classifies every side bet from the recomputed cards (`src/sidebets.ts`) and matches the served multiplier on 5,800/5,800 PP and 5,800/5,800 21+3 results; Step 11 observed all three PP and all five 21+3 categories, with no served label outside the published table; Step 26 checks every side payout as multiplier × stake exactly. The same tables appear in the game's rules modal (E02).

### Duel's edge model

Blackjack's base house edge is 0.57%: the edge of the game as dealt and paid. This audit's engine gives 0.5704% per initial bet and 0.5061% per total amount wagered.

Duel describes a rakeback on blackjack and a daily zero-edge limit (E19). Its reply of 22 April 2026, relayed to ProvablyFair.org, reads "It just gives a 0.44% (or something like that) rakeback to make it 0.1% net edge" and puts the side bets at "exactly 0 edge", which "applies to the limit". On 22 May 2026, explaining Castle Roulette, Duel gave "the same daily wager limit of up to 50k max 1k per bet". A Duel staff member's post, relayed on 1 May 2026, gives blackjack's edge as 0.57%. None of these statements gives the rakeback rate as 0.57%, says what the edge is above the limit, or names the `effective_edge` field. The config served at `GET /api/v2/blackjack/config` (E18), as fetched from duel.com on 5 October 2026 in a logged-in session (read-only GET), runs the main bet from 0.1% up to $45,748 to 0.57% at $260,608, the last tier's `max_bet`, and reduces the Perfect Pairs and 21+3 multipliers pro rata from 0.1% and 0% respectively, up to 1%. The capture does not match E18's first Perfect Pairs tier: that tier runs from $0 to $1,452.01 at 0.1% and pays 26.973 / 10.989 / 6.993, where the 5,800 captured Perfect Pairs bets, all at $0.01, carry `effective_edge` 0 and the 459 winning ones were paid 27 / 11 / 7. E18's 21+3 zero-edge tier ends at $0.0124, so it holds the captured $0.01 stake, and its multipliers equal the captured ones except Suited Trips (121.23076923 in the tier, 121.2307692 served); the next tier, to $114.70, is 0.01% and pays 4.9995 on a flush. E18 was fetched five months after the capture, and the package does not show which ladder Duel applied on 30 April – 1 May 2026. Duel's rules modal states: "Bets are processed in the following order: 21 + 3, Perfect Pairs, Main Bet. This may affect your effective house edge depending on your remaining zero edge limits." (E02). This audit did not test the rakeback, its rate, what it is paid on, the daily limit, or how the ladders are applied.

The `effective_edge` field reads 0.1 on all 6,000 hands and 0 on all 5,800 Perfect Pairs and 5,800 21+3 bets (Step 10): the same figures as the 0.1% net edge and the zero-edge side bets in Duel's 22 April reply, which does not name the field. The field is not applied to the hand: every captured hand paid standard odds (Steps 7, 20, 21, 24) and every side bet its full multiplier (Steps 8, 26).

The capture wagered $2,440.12 in all, including doubles and splits, under one day's limit. It shows the game at the captured stakes on 30 April – 1 May 2026 only (R-BRACKET, R-RAKEBACK).

### Optimal-play RTP

The engine in `src/optimal-play.ts` takes no casino input. Its inputs are the infinite-deck rank distribution (2–9 and Ace 1/13 each; the four ten-values folded into one rank at 4/13) and the rules as code. It enumerates all 1,000 (P1, P2, up-card) combinations, computes the dealer's final-total distribution under S17 with the peek on an Ace or ten up-card, takes the maximum-EV action among stand, hit, double and split by memoised recursion (split aces one card; DAS; no re-split) and sums the results. It is deterministic.

| Quantity | Value |
|---|---|
| RTP per initial bet | **99.4296%** (house edge 0.5704%) |
| Average wager of the same strategy | 1.126935 initial stakes per round |
| RTP per total amount wagered | 99.4939% (edge 0.5061%) |
| Negative control, dealer hits soft 17 | 99.2108% |
| Perfect Pairs edge, paytable paid at the captured $0.01 stake, exact over 52² deals | 0 exactly |
| 21+3 edge, same paytable, exact over 52³ deals | 16/1,406,080,000,000 ≈ 1.14e-11 |
| Player and dealer natural frequency | 4.7337% (8/169) |

The 21+3 edge comes from the 7-decimal rounding of the Suited Trips multiplier; at 121 3/13 the table is exactly balanced, and Step 16's bound for it is 1.85e-11. That side-bet EV check is an internal-consistency test of the published table; it does not verify the multipliers from first principles.

**Exact-rational oracle.** `anchor/oracle.py` (Python standard library, exact fractions, 13 distinct ranks so a 10-10 split is never folded with 10-J, a concrete hole card for every up-card) is written from the declared rules without reading the engine. It gives S17 `7016161098045143337706614398 / 7056410014866816666030739693` = 99.4296119877% and H17 `91009361114781483510240679590 / 91733330193268616658399616009` = 99.2107894950%, both pinned in `src/config.ts` (`ORACLE_RTP`). Step 16 requires the engine to equal each within 1e-12; the measured differences are 1.2e-15 and 8.9e-16.

**External references.** Neither Wizard of Odds page used states Duel's rule set: both re-split and Duel does not. Step 16 switches the same engine to each page's stated rules and requires it to reproduce the figure quoted in the pinned citation to half a unit of its last printed digit.

| Ref | Page (read 25 September 2026) | Rules the page states | Page figure | Engine |
|---|---|---|---|---|
| E14 | `wizardofodds.com/games/blackjack/expected-return-infinite-deck/` | S17, infinite deck, DAS, split up to three times except aces, one card to split aces | player EV −0.511734% | −0.51173364%, \|Δ\| 3.6e-9 ≤ 5e-9 |
| E15 | `wizardofodds.com/games/blackjack/player-expected-return/` | S17, DAS, infinite resplitting, split aces one card each, infinite decks | house edge 0.5093975% | 0.50939746%, \|Δ\| 4.4e-10 ≤ 5e-10 |

For the rules neither page states, the engine uses 3:2 blackjack, double on any two, no surrender, peek behind an ace and a ten, a natural pushing against a dealer natural, a split 21 paying 1:1 and aces not re-split. Each, flipped on the E14 rules, moves the figure outside the tolerance: no re-split −0.0587 pp, peek behind an ace only −0.1049 pp, natural paid 3:2 against a dealer natural 0.3361 pp, split two-card 21 paid 3:2 0.1999 pp, split aces re-split and played 0.2635 pp, blackjack paid 1:1 −2.2548 pp, dealer hits soft 17 −0.2194 pp. The no-re-split flip is Duel's rule set and gives 99.4296119877%. Re-splitting exists in the engine only for these references; Duel's figure is computed with one split, bit-identical before and after (0.994296119877263). The former "Wizard of Odds cross-check: 99.4296%" is withdrawn; see the release history.

**Canonical decisions.** The engine's choices match published infinite-deck S17 + DAS basic strategy on the cases checked: hard 16 v 10 hit, hard 12 v 4 stand, hard 11 v 6 double, hard 11 v A hit, soft 18 v 3 double if allowed else stand, aces split, 8s v 10 split, 10s v 6 stand, 9s v 7 stand, 9s v 6 split, 4s v 5 split (DAS), soft 13 v 5 hit. `src/strategy.ts:8-10` documents soft 13 and soft 15 against a 5 as the two cells where infinite deck differs from the standard 6-deck table.

### Simulation

**Pass 1** plays 10 streams × 1,000,000 hands under the strategy the engine uses, on 10 seed pairs generated once with `crypto.randomBytes()` (32-byte server seed, 16-byte client seed) and pinned in `SIM_SEEDS` (`src/simulate.ts`), about 35 million card draws in all. RTP is reported per original wager, the engine's convention. Each stream's RTP is z-tested against the engine at that row's own standard error and the 10 p-values are combined by Fisher's method.

| Quantity | Value |
|---|---|
| Aggregate simulated RTP | 99.4670%, +0.0374 pp from the engine (range across streams 99.28% – 99.63%) |
| Fisher's combined statistic | T = 16.48 (df = 20), p = **0.686432** (PASS ≥ 0.01) |
| Serial dependence | 0/10 streams flagged at Bonferroni z_crit 3.2905 / runs α 0.001; combined lag-1 r = +0.0018, runs z = −1.16, p = 0.1965 |
| First-card rank uniformity | 0/10 streams below α 0.001 (χ², 12 df; smallest p 0.0095) |

The standard error of a 10-million-hand RTP estimate is on the order of 0.04 pp, so +0.0374 pp is about 0.9 sampling SEs. [The convergence chart](outputs/rtp-convergence.html) plots the mean of the 10 streams' running RTP at {1K, 5K, 10K, 50K, 100K, 500K, 1M} hands, not a single stream.

**Pass 2 Test C (verdict-bearing, added 24 September 2026).** For each of the 120 revealed seeds, the declared strategy is played on nonces 0–9,999 and gross returns are summed per window of 50. The served window is the 50 nonces the capture actually played on that seed (0–49 on 113 epochs; 0–50 less the missing nonce on the 7 gap epochs); the null is that seed's other 199 windows. The rule was fixed in `src/cherry-pick.ts` before the rows were generated: rank = null windows returning no more than the served one (ties count against flagging), p = (1 + rank)/200, flag at p < 0.05 (rank ≤ 8, null flag probability ≤ 0.045), and Step 18 FAILs above N · 0.045 + 5σ + 1. Verify replays all 120 × 10,000 hands itself; the artifact's rows must equal the replay.

Result: **7/120 seeds flag** (5.40 expected; FAIL bound 17.75; smallest p 0.010); rows equal the replay on 120/120; first-card rank screen 0/120 below 0.001. Detection power against an operator serving the lowest-returning of K candidate windows, per seed and at audit level if half the seeds are picked: K=2 0.125 / 0.013; K=5 0.200 / 0.214; K=10 0.333 / 0.890; K=20 0.467 / 0.998. A weak selector (best of 2 or 5) on part of the seeds would usually go undetected in 120 seeds; a selector choosing among 10 or more candidates on half the seeds would usually be caught.

**Pass 2 Test B (the original two-sided test, kept so its figures stay traceable).** Each seed's early-window average per-hand return (50 nonces) is compared with its extended-window average (nonces 50–9,999) by a two-sample z-test, using the extended window's per-hand variance, flagged at α = 0.05 per seed. Result: **11/120 flagged** (6 early-window low, 5 high; 6.0 expected), binomial p = **0.038450**, above the predeclared reject threshold α = 0.01, so it passes; it would reject at a single-test 0.05 reading. Two non-malicious readings apply and the audit does not separate them: sampling variance (σ ≈ 2.39, so 11 is about 2.1σ above the mean) and a construction artifact of the 50-nonce window and the variance estimate. Neither changes the expected RTP, which is a property of the rules.

### Captured returns

| Phase | Hands | Initially wagered | Returned | Empirical RTP |
|---|---:|---:|---:|---:|
| A | 3,300 | $99.00 | $101.62 | 102.65% |
| B | 1,000 | $30.00 | $29.59 | 98.63% |
| C | 500 | $15.00 | $17.86 | 119.07% |
| D | 500 | $15.00 | $17.35 | 115.63% |
| E | 200 | $2,000.00 | $1,805.00 | 90.25% |
| F | 500 | $15.00 | $16.29 | 108.62% |
| All | 6,000 | $2,174.00 | $1,987.71 | 91.43% |

These are informational. The phases mix strategies, and side-bet hits drive large variance in A–D and F. The total is dominated by Phase E ($2,000 of $2,174). Phase E, main bet only under basic strategy, is the only phase comparable with the engine: $1,805.00 returned against $1,988.59 expected, a deficit of $183.59 = 0.918 standard deviations, one-sided p 0.179. Phases A–D and F together returned $182.71 on $174 (105.0%). Step 30 labels the capture's money path (returned/staked 91.4309% over 6,000 rounds) a reconciliation, not an RTP.

Live context, not scored: natural blackjack 260/6,000 = 4.33% against 8/169 = 4.7337% (about 1.5σ below); Perfect Pairs 459/5,800 = 7.91% against 4/52 = 7.6923%; 21+3 569/5,800 = 9.81% against about 9.88%; outcomes win 2,261 (36.1%), lose 1,916 (30.6%), bust 1,318 (21.0%), push 514 (8.2%), blackjack 260 (4.1%). Step 30's live fit: first-card rank χ² = 8.587 (12 df, p = 0.7377); player naturals 277 (z −0.43) and dealer naturals 314 (z 1.82) against 8/169.

### Duel's stated edge

A Duel staff member has stated a 0.57% edge for blackjack, in a post relayed to ProvablyFair.org on 1 May 2026 (E19). The engine gives 0.5704% per initial bet, which rounds to the stated figure. Since 14 October 2026 (Methodology v1.1, decision D4) the comparison is scored: `outputs/rtp-claim-table.json` holds the main bet's exact optimal-play RTP per initial bet (the oracle fraction Step 16 pins, 99.429612%) against a flat 99.43% claim under the RTP-CLAIM rule 1.2.0, switched on (decision D3), on Step 16, the step carrying BLACKJACK-19. Outcome: pass, 0.000388 pp below the claim, inside the 0.1 pp band. A house-side miss would make the verdict RTP FIGURE OVERSTATED (exit 5), never NOT PROVABLY FAIR. The staff statement is not one of the rule's six places (game page, fairness page, help page, bet panel, rules, game settings); it is the figure this package and Methodology v1.1 cite for blackjack. The side bets, which Duel states as zero edge (E19), are not in the table: a zero-edge line, noted, not tested. For blackjack, 0.1% is the bottom tier of the main-bet scaling ladder in E18 (Duel's config as fetched from duel.com on 5 October 2026 in a logged-in session, read-only GET), the value the `effective_edge` field carries, and the net edge after rakeback in Duel's 22 April 2026 reply (E19); it is not the base game's edge.

## Verification results

The verifier scores 38 steps: **36 PASS, 2 capture-origin FLAGs (Steps 4 and 37), 0 hard fails**, `PROVABLY FAIR — Full Pass`, exit 0. Steps 1–27 are the commitment, determinism, payout, dataset, simulation and game-specific battery; 28–33 the rule-coverage checks; 34 artifact integrity; 35–38 the Framework 1.0 Blackjack checks added on 24 September 2026.

| Step | Check | Result |
|---:|---|---|
| 1 | Seed hash integrity | PASS: 120/120 revealed seeds hash to their commitments; all 120 bet-bearing commitments have a revealed seed, and every seed record that carries a seed (attached after the capture) carries the right one |
| 2 | Commitment linkage | PASS: 120 `nextServerSeedHash` → next `serverSeedHashed` links from the rotation-response fields of the seed records; the first epoch's rotation record is no later than its first bet, at one-second resolution; that record was taken inside the capture; the capture reference reads the active seed's next hash before the first rotation, compares it in memory with the hash that rotation makes active and then overwrites it (`capture/capture.reference.js` lines 426–444), and the dataset holds no link before the first epoch |
| 3 | Hash consistency within epoch | PASS: bets ordered by casino transaction id and cut into 50-bet windows; window k carries record k's hash, client seed and phase (6,000/6,000) and settles between records k and k+1 |
| 4 | Nonce audit | **FLAG (capture origin):** every epoch starts at 0, no nonce served twice, nonces rise with transaction id (each a hard FAIL); 7 single-nonce gaps in 7 epochs, each a register row in `src/loader.ts`; the missing hands are NOT verified (DL-1) |
| 5 | Card recomputation | PASS: 6,000/6,000 hands, 33,194 cursors, every card at its declared cursor; 269/269 split rounds in the declared order, strictly |
| 6 | Client-seed influence | PASS: all 6,000 initial deals (cursors 0–3) change under a wrong and under an empty client seed: 0 identical against 0.0008 expected (FAIL above 2) |
| 7 | Settlement from the cards | PASS: 6,000/6,000 rounds; the label equals the derivation on all 6,269 hands; `amount_won` exact in 1e-18 units; 82,400/82,400 money strings on the grid; insurance never taken |
| 8 | Multiplier provenance | PASS: 5,800 PP and 5,800 21+3 served multipliers equal the declared paytable for the category re-derived from the cards, as exact rationals |
| 9 | Bet-size invariance | PASS: 200 Phase E hands at $10 recompute card for card and settle by the same rules; stake is not an HMAC input |
| 10 | Captured `effective_edge` | PASS: 0.1 on 6,000/6,000 hands, 0 on 5,800/5,800 PP and 21+3; not applied to the hand, not the game's edge ([Duel's edge model](#duels-edge-model)) |
| 11 | Config completeness | PASS: all five 21+3 and all three PP categories observed; no served label outside the table |
| 12 | Epoch size | PASS: all 120 epochs have exactly 50 bets (the capture's epoch size) |
| 13 | Population and phases | PASS: 6,000/6,000 hands and 121/121 seed records against the plan pinned in `src/loader.ts` |
| 14 | Dataset hash and config block | PASS: SHA-256 matches its pin; config block equals `src/config.ts`, 8/8; replay, settlement, engine and simulator read one `RULES` |
| 15 | Phase D client seeds | PASS: 500 hands across 10 distinct auditor seeds, none reused; all recompute in full (2,793 cursors); predictable, exposed epochs listed (DL-2) |
| 16 | Anti-circularity (engine) | PASS: engine equals the oracle within 1e-12 under S17 and H17; 99.4296% / 99.4939%; H17 control 99.2108%; side-bet edges exact at the captured paytable; E14 and E15 reproduced under their own rules |
| 17 | Simulation Pass 1 | PASS: 10M hands, Fisher's p = 0.686432 recomputed from the 10 rows; 0 serial flags; first-card rank 0/10 streams below 0.001 |
| 18 | Pass 2 cherry-pick | PASS: Test C 7/120 flagged (5.40 expected, FAIL above 17.75), rows equal the replay 120/120; Test B 11/120, binomial p = 0.038450 |
| 19 | Dealer rule | PASS: 4,216 dealer-played rounds S17-compliant both ways; 1,784 exempt rounds show two dealer cards; 75/75 soft 17s stood |
| 20 | Blackjack 3:2 | PASS: 277 naturals: 260 pay exactly 2.5× plus side returns, 17 push at 1× against a dealer natural |
| 21 | Double payout | PASS: 1,291 rounds, 1,368 doubled hands reconcile (win 4×, push 2×, loss 0) |
| 22 | Split draw order | PASS: 269/269 split rounds card for card in the declared order (2,259 cursors); a cursor multiset until 24 September 2026 |
| 23 | Split rules | PASS: 269 splits, 109 with DAS, 0 re-splits |
| 24 | Split payout independence | PASS: 269/269 reconcile to per-hand settlements; split two-card 21 settles as a total (30/30) |
| 25 | Insurance prompt condition | PASS: 462 prompts, all on an Ace; 462/462 Ace-up deals prompted; flag agrees on 6,000/6,000 deals; payout side not exercised (R-INSURANCE) |
| 26 | PP and 21+3 payout | PASS: 5,800 + 5,800 payouts equal multiplier × stake exactly |
| 27 | Side-bet independence | PASS: results unchanged deal→final; 307/307 winning side bets on split rounds still paid |
| 28 | Available actions | PASS: every list ⊂ {hit, stand, double, split, insurance, no_insurance}; surrender never offered |
| 29 | Infinite deck | PASS: repeated rank+suit within the initial four cursors against the with-replacement expectation, \|z\| ≤ 5 |
| 30 | Outcome distribution and live fit | PASS: no surrender or unknown result; first-card χ² = 8.587 (p = 0.7377); naturals z −0.43 and 1.82; money path 91.4309%, not an RTP |
| 31 | Side-bet stake equality | PASS: PP 5,800/5,800 and 21+3 5,800/5,800 |
| 32 | Initial deal and hidden state | PASS: 6,000/6,000 deals 2 + 2 with the hole face down (443 auto-resolved naturals reveal it); 8,313 pre-settlement responses carry an empty hole rank and suit, an up-card-only dealer value and no server seed |
| 33 | Stake bracket bounds | PASS: 6,000/6,000 at the declared stake for their phase |
| 34 | Artifact integrity | PASS: the two simulation artifacts match their SHA-256 pins; all 780 numeric leaves inside their declared domains; no pinned HTML loads anything external |
| 35 | Draw bias bound | PASS: MAX_FAIR = 52 × 82,595,524; bias exactly 0 (limit 2⁻³²); 0 rejected chunks over 33,194 draws (DL-4) |
| 36 | Round replay and action grammar | PASS: 6,000/6,000 rounds replayed from seed and recorded actions reproduce every hand; 0 grammar violations; 8,313 card counts agree; 574 rounds end at the deal on a natural (peek) |
| 37 | Rule and coverage register | **FLAG (capture origin):** every rule observed with its witness count except insurance 2:1, ASSUMED: 0 of 462 prompts funded against a floor of 100 (DL-3) |
| 38 | Player-verifier parity | PASS: docs-site verifier and live verify-bets bundle agree on every card, outcome and return (0 disagreements); Duel's Verify-tab code, run as a second check: 300,000/300,000 cursors equal `src/rng.ts`, 33,194/33,194 served cards, 5/5 fixed hash vectors |

**The nonce flag.** Each gap is a single nonce in an epoch that still holds its 50 recorded bets, under a revealed seed whose SHA-256 matches its commitment, with a settlement-clock gap of at least 14 s across it (gap-free pairs: median 3 s, 99th percentile 10 s); the capture script's error path plays the in-flight hand out unrecorded and backs off 3 s. The gap count must equal the 7 declared in `EXPECTED_CAPTURE_RETRY_GAPS`; a gap not in the register is operator-side and a hard FAIL. An earlier Step 4 counted a gap as "retroactively verified" because the seed yields a card at the missing nonce; that holds for any gap by construction, so the condition was removed. The revealed seeds allow the missing deals to be calculated, but there is no served response to compare: **these seven hands are not verified.**

| Epoch (first 16 hex of the commitment) | Missing nonce | Phase | Clock gap |
|---|---:|---|---:|
| `d1ec528647780f2f` | 2 | A | 16 s |
| `34cdf0e1b927a697` | 35 | A | 31 s |
| `c83531db458a4e74` | 11 | A | 40 s |
| `45ee24c75397834b` | 15 | A | 15 s |
| `981d7c37fccbba89` | 37 | A | 14 s |
| `86525716901d3472` | 7 | B | 15 s |
| `004ea5229361e9bc` | 24 | B | 16 s |

**The insurance flag.** The offer condition is verified (Step 25); the 2:1 payout path is not, because the capture declined all 462 prompts. Step 37 holds the declared rules to the framework floors: splits 269/200, ace splits 34/20, DAS 109/100, doubles 1,368/500, funded insurance 0/100 short. No voided or aborted game was observed.

S5: fairness-integrity matrix; game-integrity testing not commissioned.

**Offline consistency checks.** This audit's own checks S-1 … S-14, all PASS: RNG and cursor manipulation (Step 5); modulo bias (Step 35); hidden client-seed override (Step 6); stake-dependent RNG (Step 9); dealer S17/H17 deviation (Step 19); hole-card swap, all 6,000 hole cards equal cursor 3 (Step 5); blackjack payout (Step 20); double payout (Step 21); split cursor reuse or reordering (Steps 5, 22); split payout independence (Step 24); insurance trap (Step 25); Perfect Pairs payout and 21+3 payout including the priority order (Steps 8, 26); side-bet input scope (Step 27). A three-card 7C 7C 7C qualifies as suited trips, three of a kind and flush; the classifier and the casino agree on the highest-priority match. R-MULTI and R-BRACKET are out of scope by design. These checks are replay and analysis, not attempted manipulation of the live API.

<!-- S5-MATRIX:BEGIN -->
| Test ID | Category | What the framework tests | Result | Tied to |
|---|---|---|---|---|
| S5-1 | Replay protection | A completed bet ID cannot be replayed to duplicate a payout | Not tested | No replay request was sent during the capture. Observed only: every captured round settled once, with one `amount_won` that Step 7 reconciles exactly. MANIFEST DL-8 |
| S5-2 | Input validation | Invalid, out-of-range or malformed parameters are rejected | Not tested | The capture sent only valid requests (stakes $0.01 and $10, legal actions). MANIFEST DL-8 |
| S5-3 | Seed integrity under adversarial input | Server and client seed fields cannot be injected or overridden via the API | Not tested | No injection was attempted. Observed only: every hand carries its rotation record's committed hash and client seed (Steps 1–3), and the 10 player-set Phase D seeds are the ones the cards were computed with (Step 15). MANIFEST DL-8 |
| S5-4 | Cross-player isolation | One player's seeds, nonces or outcomes are not observable or influenced by another | Not tested | Single test account. MANIFEST DL-11, DL-8 |
| S5-5 | Payout field integrity | Client-supplied payout or multiplier values are ignored by the server | Not tested | The capture never sent a payout or multiplier field. Observed only: every `amount_won` equals the settlement derived from the cards, exactly (Step 7). MANIFEST DL-8 |
| S5-6 | Nonce sequence enforcement | Nonces cannot be forced, replayed or skipped via the API | Not tested | No nonce was supplied by the client. Observed only: nonces start at 0, never repeat and have no operator-side gap in all 120 epochs (Step 4; seven declared capture-retry gaps, DL-1). MANIFEST DL-8 |
| S5-7 | Parameter boundary enforcement | Bet amounts, configuration values and game parameters outside valid ranges are rejected | Not tested | No out-of-range stake or action was sent. MANIFEST DL-8 |
| S5-8 | Game-specific state | For Blackjack: acting on a finished hand, doubling after a hit, splitting a non-pair, re-splitting | Not tested | None was attempted. Observed only: the served action lists never offer an illegal action (Steps 28, 37) and every recorded action stream replays under the declared rules with 0 grammar violations (Step 36). MANIFEST DL-8 |
<!-- S5-MATRIX:END -->

All eight framework rows are **Not tested**: the capture recorded normal play and sent no adversarial request to Duel's API. The "Observed only" notes state what the captured data does show; none substitutes for the adversarial test. Closing any row needs a deliberate probe capture (DL-8).

## Reproduce the audit

Use **Node.js 22.x**, as pinned by `package.json` `engines` and `.nvmrc`. Run from the extracted package directory:

```sh
npm ci
npm test
```

`npm test` runs the Mocha unit tests (`tests/blackjack/BlackjackTests.ts`, `tests/blackjack/FrameworkTests.ts`, `tests/blackjack/RngSpecTests.ts`) and the 38-step verifier against the hash-pinned dataset and the committed simulation artifact. The unit tests include the exact-rational oracle re-run with `python3` (skipped on a machine without it; Step 16 still scores the pinned oracle figures) and Duel's Verify-tab code executed on every captured hand and on fixed hash vectors. Expected summary: `Passed: 36/38`, two capture-origin FLAGs (Steps 4 and 37), `VERDICT: PROVABLY FAIR — Full Pass`, `REPRODUCED`, exit 0. Step 18 replays 1,200,000 hands. Measured on 24 September 2026, `npm test` took 25–40 seconds; the release manifest records 102 seconds on 28 September 2026 on an Apple M2 Max shared with other runs. It does **not** regenerate the simulation: the committed `outputs/simulation-results.json` is a pinned artifact scored as-is by Steps 17 and 18.

| Command | Purpose |
|---|---|
| `npx mocha` | Unit tests only |
| `npm run verify` | Verification; writes `outputs/run/` and field-diffs against the committed results |
| `npm run simulate:run` | Regenerate the simulation into `outputs/run/` |
| `npm run test:full` | `simulate:run` + mocha + verify, with the regenerated simulation field-diffed against the pinned copy |
| `npm run mutate` | The mutation battery (`tests/mutations.json`), serially in throwaway copies |
| `npm run check:site -- --live` | Check that the live www.provablyfair.org verifier still serves the pinned bytes |
| `npx ts-node src/optimal-play.ts` | Print the analytical RTP only |

`npm run verify` writes nothing into `outputs/`. Its results and `diff.json` go to `outputs/run/`, a gitignored run record, so a re-run cannot replace the evidence it scores. `outputs/run/diff.json` compares the run with the committed results field by field (and, after `npm run test:full`, the regenerated simulation with its pinned copy) at **1e-14 absolute + 1e-12 relative**; two distinct integers never agree. The two simulation artifacts are SHA-256-pinned in `src/artifact-pins.ts` and re-hashed by Step 34; neither carries run metadata, so on the pinned `SIM_SEEDS` a regeneration reproduces the committed bytes exactly (measured on Node 22.23.1, 24 September 2026). The dataset hash is the identity of the captured bytes and is never rewritten to make a run agree with it.

| Exit | Meaning |
|---:|---|
| 0 | `PROVABLY FAIR — Full Pass`, and this run reproduces the committed artifact |
| 1 | At least one hard fail, or a reproduction difference beyond tolerance |
| 2 | At least one operator-origin FLAG (`Conditional Pass`); the capture-origin FLAGs of Steps 4 and 37 are verdict-neutral and exit 0 |
| 5 | `RTP FIGURE OVERSTATED`: no draw check failed, but the RTP-CLAIM rule (1.2.0, switched on) found the RTP below the published figure by more than the 0.1 pp band. It outranks a Conditional Pass; a hard fail (exit 1) outranks it. A committed RTP-claim table that differs from the run, or from its pin, exits 1 |

Measured on 24 September 2026 on a fresh clone of the workshop (Node 22.23.1): `npm ci --offline` from the local npm cache in under 1 s, `npm test` exit 0 in 25 s, `npm run test:full` exit 0 in 167 s with 0 differences against both committed artifacts and a byte-for-byte regeneration of the simulation JSON and chart; every pinned SHA-256 was unchanged after both runs. An `npm ci` that has to download from the registry was not measured.

Verify the dataset identity independently:

```sh
shasum -a 256 data/blackjack-dataset-6000hands.json
# 55d4b4b1850856c8a3ecf6e59021f1f80bb3d8053376c42929e58b6733b8cae4
```

For deliberate artifact maintenance only: `PF_EMIT=1 npm run verify` refreshes `outputs/verification-results.json`; `npm run simulate` (`PF_EMIT=1`) rewrites the pinned simulation artifacts, which must be re-pinned in `src/artifact-pins.ts` in the same commit; then `npm run release-manifest` and `node scripts/release-manifest.mjs --check`. The release generator requires both README.md and MANIFEST.md and checks their audit ID.

**Profile and mutation coverage.** `src/profile-map.ts` maps every scored step to the profile's BLACKJACK-nn checks and the mapping is emitted into `outputs/verification-results.json`. A check is labelled `full` only where the step decides the profile's assertion and a declared mutation shows its FAIL is reachable; everything else is `partial`, with what is missing. The battery requires the NAMED step to fail. Forged-evidence entries edit the dataset, the simulation artifact or a vendored verifier and re-pin its SHA-256, as a forger would. The release manifest records the run of 20 October 2026: the whole registry of 68 entries, 68/68 must-fail mutations caught by their named step, 0 missed, one declared survivor (S02, tied to DL-3), 38/38 scored steps covered (release history, 20 October 2026). Earlier, the release record reported 65/65 caught on 28 September 2026. The former survivor S01 (the all-chunks-rejected branch returning a card instead of throwing) has been caught since 25 September 2026 by Step 38's fixed vector V4 run through the operator's code and is now must-fail entry M38k. The documentation consolidation did not rerun the battery. Rerun on 14 October 2026 as one serial `npm run mutate` on the tree carrying RTP-CLAIM 1.2.0 switched on (Apple M2 Max, Node v22.23.1): 65/65 must-fail mutations caught by their named step, 0 missed, 1 declared survivor (S02), 38/38 scored steps covered. Second pass, 14–15 October 2026 (FIXPASS2 class C3, the exit-5 entries): see the release-history entry "14 October 2026 (second pass)"; the release manifest recorded that run until 20 October 2026.

## Verify a bet

Everything below uses the field names Duel serves; nothing needs this package installed.

1. **Save the commitment before you bet.** While a server seed is active, Duel shows its commitment `server_seed_hashed` ("Active server seed (Hashed)" in the Provably Fair panel), your `client_seed` and each hand's `nonce`. Copy the commitment and keep it before you place the hands you want to check. After you rotate, each hand's transaction record carries the plaintext `server_seed`.
2. **What to copy** from one hand: `server_seed`, `client_seed`, `nonce`, the cards dealt and the actions taken, plus the commitment you saved in step 1.
3. **The commitment.** `SHA-256(hex-decoded server_seed)`, the 32 bytes the 64 hex characters encode, not the text, must equal the commitment you saved before betting. A match is hash equality: the revealed seed is the one behind that commitment. It does not by itself show when the commitment was made; a commitment copied after the reveal would also match a seed chosen after settlement. The assurance that the seed was fixed before your hands comes from your own record, saved before you bet.
4. **The draw.** Card number `cursor` (0, 1, 2, …) is `HMAC-SHA256(key = hex-decoded server_seed, message = "<client_seed>:<nonce>:<cursor>")`. Read the result as eight big-endian 32-bit numbers; the first below 4,294,967,248 picks `CARDS[value mod 52]`, where `CARDS` runs 2♦ 2♥ 2♠ 2♣ 3♦ … A♣. The deck is infinite, so a card can repeat within a hand.
5. **The deal order.** Cursor 0 is your first card, 1 the dealer's up-card, 2 your second card, 3 the dealer's hole card; then your extra cards in the order drawn; then the dealer's draws.
6. **The split order.** After a split, cursor 4 is the second card of the hand built on your first card and cursor 5 the second card of the other hand; then the first hand plays out, then the second, then the dealer.

This script does steps 3–6 for one hand (Node 18+, no install). The example is a captured split round (hand 13419067, nonce 45 of the second epoch): 7♥ 7♠ against a 5♥, split, both hands doubled.

```js
const crypto = require('crypto');
const serverSeed = '306d29e25ef7d076d1085071808420823ad2596e049af39aa41284d3b5ac6643';
const serverSeedHashed = '27674345267704331cc6f6f2ee91e94ca47d2d1076774a75b2191a7ec9b2fddd'; // your own hand: the commitment you saved before betting
const clientSeed = 'pf_hc9GvK8F3fFn7', nonce = 45;
const CARDS = [];
for (const r of ['2','3','4','5','6','7','8','9','10','J','Q','K','A']) for (const s of ['D','H','S','C']) CARDS.push(r + s);
const card = (cursor) => {
  const h = crypto.createHmac('sha256', Buffer.from(serverSeed, 'hex')).update(`${clientSeed}:${nonce}:${cursor}`).digest();
  for (let i = 0; i < 32; i += 4) { const v = h.readUInt32BE(i); if (v < 4294967248) return CARDS[v % 52]; }
  throw new Error('all eight chunks rejected');
};
console.log('commitment matches:', crypto.createHash('sha256').update(Buffer.from(serverSeed, 'hex')).digest('hex') === serverSeedHashed);
const c = [...Array(9)].map((_, i) => card(i));
console.log('you', c[0], c[2], '| dealer', c[1], c[3]);
console.log('after the split: hand 1', c[0], c[4], '(+ double', c[6] + ')', '| hand 2', c[2], c[5], '(+ double', c[7] + ')');
console.log('dealer draws', c[8]);
```

Printed for that hand: `commitment matches: true`, you 7H 7S, dealer 5H 2D; hand 1 7H 2D (+ double 2D), hand 2 7S 4D (+ double KC); dealer draws JS. These are the cards Duel served: dealer 5H 2D JS = 17, hand 1 11 loses, hand 2 21 wins. The [ProvablyFair.org verifier](https://www.provablyfair.org/verify-bets) computes the same cards, and so does Duel's own Verify-tab code (E17), run unmodified on every captured round (Step 38). `commitment matches: true` is hash equality with the value in `serverSeedHashed`; for this captured example that value is the commitment the capture recorded at the rotation that opened the epoch, and for your own hand it is the one you saved before betting. A matching hand verifies that round against the supplied inputs; it does not by itself establish that every other round is fair.

## Evidence

The primary evidence is the capture of 6,000 hands with its revealed seeds and its config block. Screenshots illustrate interface states; they do not replace the recorded responses. Verification steps do not read or hash screenshots.

| ID | Preserved file | Evidence and role |
|---|---|---|
| E01 | [Mid-play table](evidence/E01-mid-play.png) | Player Q♥+J♥ (20) against a dealer 8♥, action buttons and chips: the game as a player sees it |
| E02 | [Side-bet paytables](evidence/E02-blackjack-payouts.png) | Rules modal, Sidebets tab: Perfect Pairs 27× / 11× / 7× and 21+3 ~121× / 53× / 32× / 12× / 5× (total returns), and the footer "Bets are processed in the following order: 21 + 3, Perfect Pairs, Main Bet. This may affect your effective house edge depending on your remaining zero edge limits."; compared with `src/config.ts` and the dataset's config block (Step 14) |
| E03 | [Fairness page](evidence/E03-fairness-page-overview.png) | Duel's `/fairness` overview: the operator's statement of the commit-reveal scheme with HMAC-SHA256 (Steps 1–3) |
| E04 | [Operator verifier page](evidence/E04-fairness-verify-blackjack.png) | `/fairness/verify` with Blackjack selected, seed and nonce inputs and the code panel; the panel's JavaScript is E17; the Verify button itself was not probed (DL-6) |
| E05 | [Active commitment](evidence/E05-active-commitment.png) | In-game Provably Fair panel: active hashed server seed, client seed and nonce, the commitment a player sees before betting. Illustrative only: its active commitment (`d2678bfab880…`, nonce 0) is the next-seed hash in the dataset's final rotation record, and no recorded bet carries it, so it is not pre-bet evidence for any recorded hand |
| E06 | [Bet history](evidence/E06-bet-history.png) | `/transactions/bets-casino` listing of the audit account's hands with bet IDs, wagers, payouts and times: a player can list their own hands |
| E07 | [Rotation control](evidence/E07-rotation-prompt.png) | Provably Fair panel with the Rotate seed button: active client seed, active hashed server seed, nonce, new client seed and the next seed's commitment, labelled "Next server seed (Hashed)". Illustrative only: neither hash it displays (active `5b612938a7ad…`, next `26edec84e8db…`) is in the dataset, so no recorded bet was placed under either |
| E08 | [Natural blackjack](evidence/E08-natural-blackjack.png) | Player A♠+K♥ against dealer 3♠+Q♣, paid 3:2 in the UI (Step 20 verifies the amounts) |
| E09 | [Insurance prompt](evidence/E09-insurance-prompt.png) | Player 8♣+2♦ against dealer A♦ with the Insurance? No / Yes modal (Step 25); insurance was never funded (DL-3) |
| E10 | [Split resolved](evidence/E10-split-resolved.png) | Kings split into K♠+Q♦ (20) and K♥+7♥ (17), each with its own $0.01 chip, dealer A♦ (Steps 22, 24) |
| E11 | [Perfect Pair 27×](evidence/E11-perfect-pair-27to1.png) | Player 5♥+5♥, dealer J♠+A♠, a $0.27 PP payout chip (Steps 8, 26) |
| E12 | [Custom client seed](evidence/E12-custom-client-seed.png) | The audit seed `pfaudit_bj_seed01` typed into the New client seed input: a player-set seed is accepted verbatim (Phase D, Step 15) |
| E13 | [Default client-seed generator](evidence/client-seed-origin.png) | DevTools view of the live bundle `assets/index-DlvddfIT.js` (byte offsets 337443–337602 and 339743–339871, captured 3 June 2026): the default client seed is 16 characters from a 63-character alphabet via rejection-sampled `crypto.getRandomValues`, pre-filled by `FairnessNextSeed.vue` and sent only on rotation. The capture did not use it (DL-2) |
| E14 | [Citation](evidence/E14-woo-expected-return-infinite-deck-2026-09-25.json) and [quoted paragraph](evidence/E14-woo-expected-return-infinite-deck-2026-09-25-crop.png) | `https://wizardofodds.com/games/blackjack/expected-return-infinite-deck/`, fetched 25 September 2026 (page "Last updated: Aug 03, 2026"), 193,272 bytes, SHA-256 `6c029ae1c0fb8919bf47d6e2493ea9d61f64ef20c76dd19c2aadc7f6a83d3d66`. Step 16 reads the figure from the quote "Based on these rules, the player's expected value is -0.511734%."; citation SHA-256-pinned in `src/config.ts` |
| E15 | [Citation](evidence/E15-woo-player-expected-return-2026-09-25.json) and [quoted paragraph](evidence/E15-woo-player-expected-return-2026-09-25-crop.png) | `https://wizardofodds.com/games/blackjack/player-expected-return/`, fetched 25 September 2026 (page "Last updated: Aug 03, 2026"), 208,531 bytes, SHA-256 `52913fc0d694858115124ea15b7ef3b25e169242faa080c2490049371eb3bf25`. Step 16 reads the figure from the quote "Based on these rules the house edge is 0.5093975%."; citation SHA-256-pinned in `src/config.ts` |
| E16 | [Search log](evidence/E16-woo-search-log-2026-09-25.tsv) | The 25 September 2026 search of wizardofodds.com for the figure formerly cited (99.4296% / 0.5704%): 76 GET requests (09:33–09:49 UTC), 65 page requests answered 200 (48 distinct pages after redirects), 7 answered 404, and 4 site-search queries whose served HTML carries no results; each with time, final URL, bytes, SHA-256 and match count. 0 matches on the 48 pages; client-side search results were not checked |
| E17 | [Operator Verify-tab code](evidence/verify-tab/duel-verify-tab-blackjack-2026-09-25.js) | Duel's Blackjack verification code from the code panel of duel.com → Provably Fair → Verify, copied by Paulo on 25 September 2026 and saved verbatim; 3,612 bytes, 112 lines, SHA-256 `1dabca2a387ace93fadfdf4c94c8fad5e60b6a6cab26bb655d0f7622f0fe16b2`, pinned in `src/operator-verifier.ts` with [its runner](verifier-parity/operator/run-operator-verifier.cjs). Run by Step 38 as a second check on `src/rng.ts`, not its source (until v1.1.0 the port cited 12 of its lines in `OPERATOR_SOURCE_CITES`; that table was removed in v1.2.0). It does not show that the Verify button or Duel's server runs this code |
| E18 | [Blackjack config](evidence/E18-blackjack-config-2026-10-05.json) and [response record](evidence/E18-blackjack-config-2026-10-05.json.meta.json) | `GET /api/v2/blackjack/config` fetched from duel.com on 5 October 2026 at 12:16:26 UTC in a logged-in session (read-only GET); the saved response body is 52,584 bytes, SHA-256 `6e96122e91f13f6687e8118f9f6a55b42c1575f0ed4cbb7c45894b64cabbc192`, and the response record beside it gives the path, the HTTP status (200), the response headers and the fetch time: the side-bet multipliers and the `scaling_edge` ladders for the main bet (48 tiers), Perfect Pairs (91) and 21+3 (101). No step reads it |
| E19 | [Duel's statements](evidence/E19-duel-blackjack-edge-statements.md) | Duel's descriptions of its blackjack edge, quoted verbatim as relayed to ProvablyFair.org. Duel, relayed to ProvablyFair.org on 22 April 2026, answering the pre-capture questions on the game rules and the Zero Edge mechanism: "It just gives a 0.44% (or something like that) rakeback to make it 0.1% net edge", and the side bets are "exactly 0 edge", which "applies to the limit". A Duel staff member's post on X, relayed to ProvablyFair.org on 1 May 2026: blackjack's edge is 0.57% (the post was not retrieved). Duel, relayed to ProvablyFair.org on 22 May 2026, explaining Castle Roulette: "the same daily wager limit of up to 50k max 1k per bet". They give no rakeback rate of 0.57%, do not name the `effective_edge` field, and do not say how the E18 ladders apply. Reported by Duel; not tested by this audit |

E14 and E15 were first fetched on 25 September 2026 by the ProvablyFair.org HouseBets Blackjack audit (its E12, E13); this package re-fetched both the same day and the bytes were identical. The full pages were vendored from 25 to 28 September 2026 and are now cited, not shipped, because third-party pages are not redistributed. Each crop was rendered on 28 September 2026 by headless Chromium from the vendored page with network requests blocked, so the page's own styling is absent.

| File | Role |
|---|---|
| [Dataset](data/blackjack-dataset-6000hands.json) | 6,000 hands across phases A–F with each deal and action response and the final state, each epoch's rotation record (client seed, commitment, next commitment), and each epoch's revealed server seed, attached after the capture from Duel's transaction records; SHA-256 pinned in `src/loader.ts` and checked before any step and by Step 14 |
| [Simulation results](outputs/simulation-results.json) | Pass 1 (10 streams × 1M hands, Fisher's p, per-stream serial and first-card census) and Pass 2 (120 seeds × 10,000 nonces, Test C windows and Test B); also the engine's RTP block and the rule set used; SHA-256 pinned in `src/artifact-pins.ts`, re-hashed by Step 34, every numeric leaf held to `src/domains.ts` |
| [Convergence chart](outputs/rtp-convergence.html) | Self-contained inline SVG of the mean running RTP of the 10 streams; SHA-256 pinned, re-hashed by Step 34 |
| [Verification results](outputs/verification-results.json) | All 38 step results with their Blackjack profile 1.0.2 mappings and four informational items; not pinned, compared field by field with every run; refreshed only by `PF_EMIT=1 npm run verify` |
| [RTP claim table](outputs/rtp-claim-table.json) | The main bet's exact optimal-play RTP per initial bet against the flat 99.43% claim (RTP-CLAIM 1.2.0, scored on Step 16); pinned in `src/rtp-settings.ts`, rewritten by `npm run rtp-claim:write` |
| [verifier-parity/](verifier-parity/) | Byte-exact copies of the ProvablyFair.org docs-site Blackjack verifier (`games/blackjack/derive.js`, `lib/hmac-sha256.js`) and of three chunks of the live www.provablyfair.org/verify-bets page, vendored 24 September 2026, pinned in `src/site-verifier.ts` and `src/live-site-verifier.ts` and executed by Step 38; plus the operator runner |
| [Exact-rational oracle](anchor/oracle.py) | The independent RTP oracle whose fractions Step 16 holds the engine to |
| [Capture reference](capture/capture.reference.js) | The capture script's method: 6 phases, 6,000 hands, per-hand decisions, rotation every 50 hands |
| [Release manifest](RELEASE-MANIFEST.json) | Release identity, artifact hashes, recorded score and mutation-run record |

## Limitations and trust

The recorded **Full Pass** describes reproduction and consistency within the captured play. The commit-reveal chain's consistency (seed hashes and forward links), per-card determinism, the S17 rule, payout math, side-bet multiplier provenance, the optimal-play RTP and stake invariance are verified. Outside that boundary trust remains, bounded by structure: the server picks the server seed (mitigated by commit-reveal and the Pass 2 test); the capture's own client seeds were not CSPRNG draws (DL-2), though a player can supply a seed and Steps 6 and 15 show it propagates; and the capture is single-account.

**Entropy model: client seed + server seed, no public beacon.** The cherry-pick risk sits on the early-nonce window and is mitigated by the player's ability to choose their own client seed and rotate. A beacon-bound model, as in Duel Crash with drand, would bind each result to external randomness; Blackjack does not use one.

**Pre-bet commitment evidence.** Two kinds of evidence bear on whether each seed was fixed before its bets, and they establish different things. *Consistency:* every revealed seed's SHA-256 equals its commitment (Step 1) and every forward link holds (Step 2). These show the seed records fit together, not when a commitment was shown; a seed and commitment constructed after settlement would pass them too. *Timing:* that each commitment was shown before its epoch's bets rests on the capture's recorded pre-bet observations below, and so holds only as far as the capture is a faithful record of what Duel served and when (P7, assumed). Every epoch has a seed record from the rotation that opened it, timestamped by the capture no later than the epoch's first bet (97 epochs in an earlier second, 23 in the same second; `created_at` is whole seconds). The timestamp belongs to the rotation response's commitment fields; the plaintext `serverSeed` on the record was attached after the capture ([Dataset and capture](#dataset-and-capture)), so the `21:31:23.099Z` on `seeds[0]` dates its commitment, not its seed. For epochs 2–120 the commitment had already appeared as `nextServerSeedHash` in the previous rotation response, at least 106 s (median 181 s) before the epoch's first bet. Epoch 1 has no earlier record: its rotation (`21:31:23.099Z`) and first bet (`21:31:23`) fall in the same second, and the order rests on the capture script waiting for the rotation response before dealing. The record times come from the capture's clock and `created_at` from the operator's; neither is independent timestamp attestation. Duel's Provably Fair panel also shows the next seed's commitment before rotation, labelled "Next server seed (Hashed)" (E05, E07, illustrative only: both screenshots were taken after the capture, no recorded bet carries either active commitment they display, and neither displayed next hash is in the dataset, so neither is pre-bet evidence for a recorded hand).

### Declared limitations register

| ID | Limitation | Measured magnitude | Closure evidence / what would close it |
|---|---|---|---|
| **DL-1** | Seven hands missing from the capture (auditor-side retries), and no per-epoch closing nonce recorded | 7 nonces in 7 of 120 epochs, each a register row in `src/loader.ts` with a 14–40 s settlement-clock gap (gap-free pairs: 3 s median, 10 s 99th percentile). Rotation records carry `nonce` 0 only, so an epoch's window closes against the plan (base + 50 + declared gaps − 1), not a recorded end | Step 4 (FLAG, capture origin). A capture recording each epoch's last nonce at rotation; captured before the 23 September standard |
| **DL-2** | Client seeds: Phases A, B, C, E and F used `Math.random()`, not a CSPRNG; Phase D used ten fixed, predictable strings | 110 distinct `pf_` + 13-character seeds; Phase D `pfaudit_bj_seed00` … `09`, the 10 exposed epochs listed by Step 15 | Steps 6 and 15. A capture generating client seeds with `crypto.getRandomValues`; captured before the standard |
| **DL-3** | Insurance never funded: the 2:1 insurance payout is ASSUMED, not verified | 0 of 462 prompts taken (floor: 100 funded dealer-Ace rounds) | Step 37 (FLAG, capture origin); survivor S02. A capture that funds insurance on ≥ 100 dealer-Ace rounds; kept disclosed in this release and to be covered in the next capture |
| **DL-4** | The all-chunks-rejected branch of the draw is never reached | 0 rejected chunks in 33,194 captured draws (3.7e-4 expected) | Step 35 prints the census; the path is unit-tested. Since 25 September 2026 the operator's Verify-tab code (E17) is run on fixed vectors: it throws when all eight chunks reject (L75, vector V4), as `src/rng.ts` does, and a `src/rng.ts` returning a card there FAILs Step 38 (M38k). Which rule Duel's server runs is unwitnessed (P1) |
| **DL-5** | Mid-round seed rotation was not probed live | Whether a rotation requested during a hand reveals the active seed before the remaining cards are dealt is untested. All 8,313 captured pre-settlement responses carry no seed plaintext and no exposed hole card (Step 32) | Closing production item: on a test account, request a rotation during an unfinished hand and record whether the reveal precedes the remaining cards |
| **DL-6** | Duel's in-site Verify tab: its code is executed, the page is not probed | Since 25 September 2026 the code panel's JavaScript (E17) runs unmodified on all 6,000 rounds in Step 38: 300,000/300,000 cursors equal `src/rng.ts`. Whether the Verify button runs that code was not checked | Premise P2. A captured Verify-tab computation on a known hand |
| **DL-7** | **Closed 5 October 2026.** The served `effective_edge` label did not equal the modelled edge | 0.1 on all 6,000 hands against 0.5704% per initial bet | Closed by Duel's statements (E19): a staff member puts blackjack's edge at 0.57%, and Duel's 22 April 2026 reply describes a rakeback "to make it 0.1% net edge", the figure the label reads; the statements do not name the field. The capture shows the field is not applied to the hand (Steps 7, 8, 20, 26). The rakeback and the scaling edge are not tested (R-RAKEBACK, R-BRACKET) |
| **DL-8** | The framework's adversarial S5 tests were not run | All eight S5 rows are Not tested ([Verification results](#verification-results)) | A deliberate probe capture |
| **DL-9** | **Closed 24 September 2026.** Pass 2's cherry-pick statistic was two-sided with a normal-approximation null and no measured power | Test B (kept): 11/120 flagged, binomial p = 0.038450 | Closed by Test C (Step 18, `src/cherry-pick.ts`): one-sided, fixed before the rows, each seed's 199 own windows as the null, every window replayed, power printed: 7/120 flagged, FAIL above 17.75 |
| **DL-10** | **Closed 25 September 2026.** The Wizard of Odds reference's read date and page were never recorded | Until then: engine 99.4296119877% against "reference" 99.4296%, \|Δ\| 1.2e-7. That figure was not found on the 48 pages read on 25 September 2026 (E16) and equals this engine's own figure; withdrawn | Closed by two dated pages (E14, E15: vendored until 28 September 2026, cited since) whose quoted figures Step 16 reproduces under each page's rules (M16d–M16g); the oracle half was closed on 24 September 2026 by `anchor/oracle.py`. Neither page states Duel's rule set |
| **DL-11** | Single test account | Cross-account differential treatment is untestable (R-MULTI) | A multi-account capture |

### Load-bearing premises

| ID | Premise | Status | Why |
|---|---|---|---|
| **P1** | When every 4-byte chunk rejects, Duel does what `src/rng.ts` does (throw) | ASSUMED (server); witnessed in the operator's published code | No captured round reaches it: probability 2.4e-64 per draw (DL-4). E17 throws on vector V4 (Step 38); Duel's server code is not available |
| **P2** | Duel's in-site Verify tab computes the cards `src/rng.ts` computes | Witnessed for the code panel; the Verify button not probed | E17 equals `src/rng.ts` on 300,000/300,000 cursors (Step 38); whether the button runs that code was not checked (DL-6) |
| **P3** | Insurance pays 2:1 when the dealer has a natural | ASSUMED | Never funded (DL-3) |
| **P4** | The revealed `server_seed` on each transaction record is the key the deal used | Witnessed | 6,000/6,000 hands recompute from it (Step 5) and it hashes to its epoch's commitment (Step 1, a consistency check); that the commitment was shown before the epoch's bets rests on the capture's records (Steps 2, 3; P7) |
| **P7** | The capture is a faithful record of what Duel served and when: its rotation records (their commitment fields; the `serverSeed` on each was attached after the capture), their capture-clock times and the order of requests | ASSUMED | The timing of each commitment relative to its epoch's bets rests on these records (Steps 2, 3; [Pre-bet commitment evidence](#limitations-and-trust)). Hash matching and forward links are consistency checks and do not establish it; no independent timestamp attestation exists |
| **P5** | The hole card is hidden until settlement | Witnessed on the captured responses | 8,313 pre-settlement responses carry the hole card with an empty rank and suit (Step 32); not probed beyond the capture (DL-5) |
| **P6** | Duel's rules are S17, peek, DAS, split by rank, one split, split aces one card, no surrender | Witnessed | Step 37 register with witness counts; the round replay reproduces all 6,000 rounds under them (Step 36) |

### Scope items for a later audit

These are scope boundaries, not findings against the current implementation.

- **R-MULTI.** Cross-account behaviour ("high rollers see different multipliers") cannot be excluded from one account. Next step: about 1,000 hands from a second account, comparing the config table, seed entropy and `effective_edge` (about $30 at $0.01 per hand).
- **R-INSURANCE.** The 2:1 payout was never exercised: 0 of 462 prompts funded. Disclosed in this release; to be covered in the next capture. Next step: about 50 hands accepting every prompt, checking a 3× return on a dealer natural, 0 otherwise, and an unaffected main bet (about $1.50 in insurance and $0.50 in main bets).
- **R-RESPLIT.** 0 re-splits in 269 splits; the strategy split once per hand, so the capture cannot distinguish "re-split not offered" from "never asked". Step 37 adds that split was offered after a split in 0 rounds, on 46 split hands dealt a pair again. No hand was split a second time. Disclosed in this release; to be covered in the next capture. Next step: deliberately attempt re-splits (about 10 targeted hands, or 50 broader).
- **R-PASS2-EXTENDED.** Test B's p = 0.038450 has limited resolution at 120 seeds. Next step: at least 500 distinct seeds (about 25,000 hands, about $250 at $0.01 per hand).
- **R-BRACKET.** The capture wagered $2,440.12, under the daily zero-edge limit Duel states, at $0.01 and $10 main bets and $0.01 side bets. By stake, each falls in the first tier of its ladder in E18 (Duel's config as fetched from duel.com on 5 October 2026 in a logged-in session, read-only GET), but the capture was not paid as E18's first Perfect Pairs tier pays: 27 / 11 / 7 with `effective_edge` 0, against 0.1% and 26.973 / 10.989 / 6.993 in E18. The main bets sit in E18's first main tier (0.1%, to $45,748.05), and the 21+3 bets in its zero-edge first tier (to $0.0124), whose multipliers equal the captured ones except Suited Trips (121.23076923 against 121.2307692 served). Neither the higher tiers, play past the limit, nor the ladder in force during the capture was exercised or recorded. Next step: a session past the daily limit and at side-bet stakes above $0.0124, checking the served side-bet multipliers and `effective_edge` against the config fetched in the same session.
- **R-RAKEBACK.** The rakeback Duel describes was not tested: not whether it is credited, its rate, what it is paid on (the initial stake, or every stake including doubles, splits and side bets), or the $50,000 daily limit. Next step: log the rakeback credited on a session of known wagering.

The original report also listed three low-priority operator suggestions, explicitly not findings: show `nextServerSeedHash` in the fairness UI; add a public-randomness beacon such as drand to bind seed selection externally; and expose an idempotency key on the deal endpoint so retries do not fragment nonces. Its player notes still apply: supply and rotate your own client seed; verify the hands you care about after rotating; expect small sessions to swing widely around 99.4296% (Phase E's 200 hands at $10 sit 0.92σ below expectation); the side bets paid at zero edge at the $0.01 stake captured, and are high-variance; and insurance has an expected value of `2 × 4/13 − 9/13 = −1/13 ≈ −7.69%` under the infinite-deck model. Duel describes a rakeback on blackjack and a daily zero-edge limit (E19); this audit tested neither.

## Terms
**RTP:** return divided by stake; label whether theoretical, simulated or observed. **Per initial bet / per total wagered:** RTP divided by the opening stake, or by every stake including doubles and splits. **House edge:** one minus theoretical RTP. **S17 / H17:** dealer stands / hits on soft 17. **DAS:** double after split. **Soft hand:** a hand with an Ace counted as 11. **Natural:** Ace plus a ten-value card as the first two cards. **Infinite deck:** each card drawn independently with replacement. **Cursor:** per-hand card index 0–49. **Nonce:** per-hand counter within an epoch. **Epoch:** one server-seed lifecycle, here 50 hands. **Commit-reveal:** publish a hash, later disclose the seed for comparison. **Forward chain:** `nextServerSeedHash`, the next seed's commitment served before rotation. **Rejection sampling:** discard values in the biased range and read the next chunk. **Fisher's method:** `T = −2 Σ ln(pᵢ) ~ χ²(2K)` for K tests. **Bonferroni:** divide α by the number of tests. **Cherry-pick:** selecting server seeds whose early nonces disadvantage the player. **Anti-circularity:** the theoretical value used in verification must not come from casino-supplied data or an external figure. **Verdicts:** `PROVABLY FAIR — Full Pass`; `PROVABLY FAIR — Conditional Pass` (an operator-origin flag); `NOT PROVABLY FAIR` (a hard fail). **Rakeback:** a share of wagering returned to the player outside the hand. **Zero-edge limit:** the daily wagering to which Duel's zero-edge terms apply, up to $50,000 a day and $1,000 per bet in Duel's statement (E19); the rules modal calls it "your remaining zero edge limits" (E02). **Scaling edge:** Duel's stake-dependent edge, served per bet size in `scaling_edge` (E18, Duel's config as fetched from duel.com on 5 October 2026 in a logged-in session, read-only GET).

## Release history

| Release | What changed | Verdict |
|---|---|---|
| `v1.0.0` | The original audit, published 4 June 2026 | PROVABLY FAIR — Full Pass |
| `v1.0.1` | Errata: the dataset's capture metadata carried a session credential (`meta.token`) recorded by the capture script. The field was removed; no bet, seed, outcome or payout field changed, so every figure and step result is identical. Dataset hash re-pinned (was `ad9cdffcea2f6cf535361e2265ae0bf95bb1290b3bbf9fee70dda053d917fe12`) | unchanged |
| `v1.1.0` | Re-certification under Framework 1.1, October 2026, below. The dataset of record is byte-identical to v1.0.1 | unchanged |
| `v1.2.0` | The card code rebuilt from a written specification instead of ported from Duel's code; Duel's code kept as a second check. Below, "21 October 2026" and "20 October 2026" | unchanged |

**v1.1.0.** Scored steps went from 34 in v1.0.1 to 38: Draw Bias Bound, Round Replay & Action Grammar, Rule & Coverage Register and Player-Verifier Parity are new. Step 4 is now a capture-origin FLAG reporting the same 7 missing nonces in 7 epochs v1.0.1 reported (it passed in v1.0.1); Step 37 is new and a capture-origin FLAG; neither moves the verdict. Steps 5 and 22 assert the split draw order strictly (a cursor multiset until 24 September 2026), Step 6 substitutes the client seed on all 6,000 initial deals (100 hands at cursor 0 until 24 September 2026), Step 7 settles from the cards with exact money, and Step 18 decides on Test C. Added: `LICENSE` (MIT), `.nvmrc` (Node 22), `RELEASE-MANIFEST.json` (written by `scripts/release-manifest.mjs`) and the mutation battery. The comparison with Duel's stated edge is stated, not scored ([Duel's stated edge](#duels-stated-edge)). v1.1.0's release identity and the fingerprint of the ProvablyFair.org signing key (`signature`) are in the `RELEASE-MANIFEST.json` at the `v1.1.0` tag; the [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json) in this package is v1.2.0's.

**Dataset errata, 24 September 2026.** `meta.token` held the security token of the capture's browser session. It was removed with the package's own writer (`JSON.stringify(dataset, null, 2)`, no trailing newline); the diff is that one line, and the SHA-256 moved from `ad9cdffc…` to `55d4b4b1…` (pinned in `src/loader.ts`). The token's value is not reproduced anywhere in this package. No scored figure moved.

### Errata — 25 September 2026: the Wizard of Odds cross-check figure

**What v1.0.0 and v1.0.1 say.** They present 99.4296% as a Wizard of Odds figure for Duel's rule set: MANIFEST.md ("**Wizard of Odds cross-check:** 99.4296% — Δ 0.0000 pp (within 0.02 pp tolerance)"; "cross-validated against the Wizard of Odds reference for the same rule set"), README.md ("**Wizard of Odds cross-check:** 99.4296% (Δ 0.0000 pp — exact match for Duel's rule set)"), `tests/steps/simulation.ts` Step 16 (`WOO_REFERENCE = 0.994296`, gated at 0.02 pp), `src/optimal-play.ts` and `outputs/simulation-results.json` (`optimalPlay.wooReference: 0.994296`).

**What was wrong.** The figure has no recorded source: no page and no read date were recorded; the earliest record found (`git log -S0.994296`) is the first commit of the audit's private working repository, be5779b, 20 May 2026. On 25 September 2026 it was not found on the 48 Wizard of Odds pages checked: every `/games/blackjack/` page linked from the blackjack section index except the individual side-bet pages (the side-bet index was checked), the rule-variations page, appendices 1 and 4–20 (2 and 3 answer 404), the house-edge, strategy, hand and Blackjack Switch calculators, and the Ask the Wizard blackjack page (E16). The calculator offers 1, 2, 4, 5, 6 or 8 decks and no infinite deck. The two infinite-deck pages print figures for rule sets that re-split. **Not checked:** the site search (results render client-side), the individual side-bet pages, pages outside the blackjack section, content rendered only in the browser, and any earlier version of any page. 99.4296% equals this audit's own engine figure at four decimals, so the comparison compared the engine with itself.

**What replaces it.** Step 16 anchors the engine on E14 and E15 under their own rules, as described under [Payouts and RTP](#payouts-and-rtp); since 28 September 2026 the pages are cited, not shipped, with unchanged figures, tolerances and results. The exact-rational oracle (since 24 September 2026) is unchanged. **What did not change:** the engine's 0.994296119877263 per initial bet (bit-identical float64), 99.2107894950% under H17, the average wager 1.126935, 99.4939% per total wagered, the verdict and every step's status. The simulation was not re-run, which is why `outputs/simulation-results.json` still carries the legacy field `optimalPlay.wooReference` (0.994296, now `RETIRED_FIGURE_FORMERLY_CALLED_WOO` in `src/config.ts`, scored by nothing).

**Simulation regenerations.** The two simulation artifacts were regenerated by `npm run simulate` on the pinned `SIM_SEEDS` (`generatedAt` 2026-09-23T17:00:00.568Z) and re-pinned. That regeneration replaced a defective `normalCDF`, which evaluated the Abramowitz–Stegun erf polynomial at z instead of z/√2, understating every two-sided p-value (one-sided tail at z = 1.96: 0.01902 against the true 0.02500) and putting the Bonferroni critical z at 3.2026 instead of 3.2905. Its figures were Fisher's p = 0.508965 and 12/120 flagged seeds, binomial p = 0.017303; on the corrected function (`src/stats.ts`, the Numerical Recipes `erfcc` fit, fractional error < 1.2e-7) they are Fisher's p = 0.686432, 11/120 flagged, binomial p = 0.038450. Checked in 40-digit arithmetic, the approximation changes no verdict: exact Fisher p 0.68643195 (artifact 0.68643193), exact critical z 3.29052673 (artifact 3.29052675), 0 serial flags either way, and the 120 per-seed p-values give 11 flags exactly, the nearest 1.7e-4 from 0.05. The simulated RTP and every per-stream RTP were unchanged. Regenerated again on 24 September 2026: all 647 earlier values unchanged, `generatedAt` removed and four fields added so Steps 17 and 18 can re-derive their figures; the chart was rebuilt as inline SVG (new pins `97f3e2d0…`, `ae2618ec…`). Regenerated a third time that day for Test C: all 1,027 earlier values unchanged, 25,807 values added (`pass2.testC`, each seed's 200 window returns in half-stakes, Test C rank and flag, first-card census); chart bytes unchanged; new pin `d1e4e4cf…`.

**Errata, 29 September 2026.** The RTP convergence chart loaded Chart.js from cdn.jsdelivr.net at a floating major version (chart.js@4). It is now a static SVG drawn by `src/simulate.ts`, with no script and no library, plotting the same seven checkpoint values and the same 99.43% optimal-play line, each value shown to 4 decimals (the public page carried full floats). No figure changed.

### 4 October 2026 — consolidated documentation

The 21 Markdown documents in the package root were reduced to **README.md and this MANIFEST.md**. Repeated explanations were removed; the dataset, evidence files, verifier code and every step result, limitation, premise, flag, errata entry and evidence exhibit were retained. References to the former chapters in the profile-coverage map, the step detail strings and source comments now point to the retained sections, and the verification results and release manifest were regenerated with the package's own commands. Where former chapters disagreed with each other, this overview follows the step outputs. No new casino capture, simulation regeneration or mutation campaign is asserted for this update.

### Where the former chapters went

| Former file | Consolidated location |
|---|---|
| `SUMMARY.md`, README table of contents | Contents; README |
| `executive-summary.md`, `conclusion.md` | Conclusion and scope; README |
| `game-rules.md`, `rule-checks.md` | Game and algorithm (Rules) |
| `system-architecture.md` | Game and algorithm (Rules, Seed lifecycle); Dataset and capture |
| `rng-algorithm-analysis.md`, `game-logic-verifiability.md` | Game and algorithm (Card derivation); Payouts and RTP (Settlement) |
| `live-parity-testing.md` | Dataset and capture; Verification results (nonce flag); Limitations and trust |
| `exploit-testing.md` | Verification results (offline checks, S5 matrix) |
| `edge-case-analysis.md` | Game and algorithm (Rules); Payouts and RTP (Simulation); Verification results |
| `payout-verification.md` | Payouts and RTP (Settlement, Duel's edge model) |
| `rtp-analysis.md`, `optimal-play-methodology.md` | Payouts and RTP |
| `operator-trust-analysis.md` | Limitations and trust |
| `recommendations.md` | Limitations and trust (Scope items for a later audit) |
| `reproducibility.md` | Reproduce the audit |
| `evidence.md` | Evidence |
| `glossary.md` | Terms |

### Errata — 4 October 2026: pre-commitment wording

The pre-commitment wording was corrected to match the seed records. The overview placed the next seed's commitment in every deal response and in the bet records of the epoch before; none of the 6,000 deal responses or 8,313 action responses carries a next-seed field, and the next seed's commitment is in the rotation response that each seed record stores. It attributed the 114 within-phase rotations to a platform limit of 50 bets; the capture script requested them, and Step 12 now calls 50 the capture's epoch size. Step 2's anchor now reads "no later than, at one-second resolution", because the first epoch's rotation record (`21:31:23.099Z`) and first bet (`21:31:23`, whole seconds) share a second; the check itself is unchanged. The statement that an explicit pre-bet snapshot existed only at the six phase-boundary rotations (6/120 epochs), with the other 114 commitments first observed in the epoch's first bet, was withdrawn: every one of the 120 epochs has a seed record from the rotation that opened it. The statement that the fairness UI does not show `nextServerSeedHash` as a separate field (Pre-bet commitment evidence and the E07 caption) was withdrawn: E05 and E07 show it as "Next server seed (Hashed)". The Step 2 and Step 12 detail strings and the profile map changed, so `outputs/verification-results.json` and the release manifest were regenerated with the package's own commands. No step result, scored figure or verdict changed.

### Errata — 5 October 2026: Duel's edge model

The edge wording was corrected to Duel's edge model as Duel has described it. Blackjack's base edge is 0.57%, the figure a Duel staff member has stated; Duel describes a rakeback on blackjack "to make it 0.1% net edge" and a daily zero-edge limit of up to $50,000. The `effective_edge` field reads that 0.1 on every hand and is not applied to the hand; Duel's statements do not name it. The rakeback and the scaling edge are stated as described, not tested (R-RAKEBACK, R-BRACKET). DL-7 is closed. The scope sentence on per-stake tables was corrected, the side-bet edges are stated as within the daily limit, the E02 and E11 captions now give multipliers as total returns, and E18 (the blackjack config, as fetched from duel.com on 5 October 2026 in a logged-in session, read-only GET) and E19 (Duel's statements, as relayed to ProvablyFair.org on 22 April, 1 May and 22 May 2026) were added. The statements that the dataset's config block was captured from `GET /api/v2/blackjack/config` were withdrawn: neither the capture script (not shipped; capture tools ship as reference copies only) nor [the capture reference](capture/capture.reference.js) calls that endpoint, and the capture script writes the block from constants; the served multipliers on each side-bet result are unchanged and Step 8 still checks them. With E18 in the package, the Dataset section now says that no step reads a separate configuration file, where it said there was none, and records that the block's eight entries equal E18's `multipliers`. The Step 10 detail string and the profile map changed, so `outputs/verification-results.json` and the release manifest were regenerated. No step result, scored figure or verdict changed.

### Errata — 5 October 2026: commitment timing

A revealed seed hashing to its commitment, and a forward link matching, establish consistency, not timing: a seed and commitment constructed after settlement would pass both. The wording now says so wherever it presented them as more. The Seed lifecycle section and the Pre-bet commitment evidence paragraph call the hash and link checks consistency checks, and attribute the pre-bet timing to the capture's recorded observations, conditional on the capture being a faithful record (new premise P7, assumed); P4 no longer cites the hash match for the commitment's timing. Verify a bet (here and in the README) tells the player to save the commitment shown before betting and compare the revealed seed against that saved value: a match is hash equality, and the assurance about timing comes from the saved record. E05 and E07 are labelled illustrative: no recorded bet carries a commitment either displays. The Step 4 detail string no longer calls the commitment "pre-bet" in its hash-match sentence, so `outputs/verification-results.json` and the release manifest were regenerated with the package's own commands. No step result, scored figure or verdict changed.

### Errata — 6 October 2026: side-bet edge scope and seed-record provenance

The side-bet edge statement is now scoped to the $0.01 side-bet stake captured on 30 April – 1 May 2026 and states the E18 mismatch: E18's first Perfect Pairs tier is 0.1% and pays 26.973 / 10.989 / 6.993 where the capture was paid 27 / 11 / 7 with `effective_edge` 0, and its 21+3 zero-edge tier ends at $0.0124; R-BRACKET no longer says the capture sat on the bottom tier of every ladder. The overview no longer calls the seed records unmodified rotation responses: the `serverSeed` on each seed record and the `server_seed` on each bet were attached after the capture, from Duel's transaction records, by a post-capture step whose code was not kept ([Dataset and capture](#dataset-and-capture)). The Step 1 detail string and the profile map changed, so `outputs/verification-results.json` and the release manifest were regenerated with the package's own commands; no step result, scored figure or verdict changed.

### Errata — 6 October 2026: first-epoch anchor and remaining stake scope

Step 2's check on the first epoch was labelled a pre-capture anchor. It is not one: `seeds[0]`, the rotation that opened the first epoch, was recorded inside the capture (`21:31:23.099Z`, 0.834 s after `meta.createdAt` `21:31:22.265Z`), in the same whole second as that epoch's first bet (`21:31:23`), and the check compares the capture's clock with the operator's `created_at`. The capture reference reads the active seed's next hash before the first rotation, compares it in memory with the hash that rotation makes active and then overwrites it (`capture/capture.reference.js` lines 426–444); the dataset holds no link before the first epoch. The Step 2 detail string and the Step 2 row now say so, and the profile map labels BLACKJACK-02 `partial` (captured before the standard) instead of `full`; the check itself is unchanged. Three statements wider than the captured stakes were scoped to them: "One rule set serves every stake" now says the same rules settled the hands at the two captured main-bet stakes, $0.01 and $10 (Step 9), and that no other stake was tested; "Both side bets pay the published multipliers" now says they were paid at the $0.01 side-bet stake captured; and the exact side-bet edges (Optimal-play RTP table, Steps 10 and 16, the profile map) are stated as edges of the paytable the captured $0.01 side bets were paid at. The Step 2, 10 and 16 detail strings and the profile map changed, so `outputs/verification-results.json` and the release manifest were regenerated with the package's own commands. No step result, scored figure or verdict changed.

### 14 October 2026 (second pass) — an RTP miss ends RTP FIGURE OVERSTATED (FIXPASS2 class C3)

No verdict, scored step status, figure or artifact changed.

- **No unreached cell to lower in the game.** The RTP table has one setting (the main bet under the declared rules) and every rule that moves its RTP is witnessed by the captured hands or cannot be played by the code (`rulesInEffect` throws). Measured on 14 October with the rules set to H17 and the table and record regenerated in a copy: RTP-CLAIM fires (RTP FIGURE OVERSTATED on Step 16's rule line), and the run ends NOT PROVABLY FAIR, exit 1, through Steps 14, 16 and 17 (the pinned simulation ran under S17; Step 16's negative control expects H17 to move the figure), a draw failure outranking the RTP verdict. The one-setting miss is therefore tested on the table's model: MC3a prices the main bet's row at 0.99 × the pinned oracle fraction (98.4353 %, 0.995 pp under the stated 99.43 %).
- **Exit-5 mutations.** `tests/mutations.ts` gained `regen` (in the temp copy: the RTP table rewritten by `src/rtp-settings.ts` and re-pinned, then the committed record re-emitted with `PF_EMIT=1`), `expectExit` (the run must also end with that exit code), runner `test` (mocha, then the verifier) and reads the last line a step prints (a step RTP-CLAIM re-scores prints a second `[FLAG] Step N … (re-scored …)` line). New entries: MC3a (the one setting priced 1 % under its exact value in the table's model; table and record regenerated; expected RTP FIGURE OVERSTATED on Step 16, exit 5), MC3b (the claim raised to 99.63 %, 0.2 pp above the exact 99.4296 %; table and record regenerated; expected RTP FIGURE OVERSTATED, exit 5 — the claim check added on 14 October had no mutation), and MC3as and MC3bs (the same changes, table not regenerated; expected exit 1: a committed RTP table that differs from the run, or from its pin, is a reproduction failure, miss or no miss).
- **Battery (Apple M2 Max, 12 cores, Node v22.23.1).** The whole registry, then 67 entries, in one `npm run mutate` on this tree, 14 October 2026 evening: 67/67 must-fail mutations caught by their named step, 0 missed, 1 declared survivor (S02), 38/38 scored steps covered. MC3a and MC3as were added on 15 October (69 entries; MC3 and MC3s renamed MC3b and MC3bs) and `npm run mutate -- M16 MC3` reran them with every entry naming Step 16, the RTP-claim step: 10/10 caught by their named step; MC3a and MC3b ended `VERDICT: RTP FIGURE OVERSTATED` with Step 16 FLAG, exit 5; MC3as and MC3bs exit 1.

### 14 October 2026 — Methodology v1.1

No draw check, scored step status, figure or verdict changed. The dataset and the artifacts pinned in `src/artifact-pins.ts` are unchanged; the RTP-claim table is new, pinned in `src/rtp-settings.ts` (below).

- **Framework 1.1.** The audit is re-certified under ProvablyFair.org Framework 1.1 (decision D1); the release manifest's `framework` field and the release row above say 1.1.
- **RTP-CLAIM 1.2.0, switched on.** `src/rtp-claim.ts` is the framework's rule 1.2.0, byte-identical to `core/rtp-claim.ts` (SHA-256 `c9a9c1c4…5f131c`), and `src/rtp-claim-switch.ts` is set to true (decision D3). This package carried no copy of the rule until now (decision D4). It now has `src/rtp-settings.ts`, `npm run rtp-claim:write` and the pinned table `outputs/rtp-claim-table.json`: one setting, the main bet's exact optimal-play RTP per initial bet (the oracle fraction in `src/config.ts` ORACLE_RTP, 99.429612%), held to a flat 99.43%, the 0.57% edge a Duel staff member stated (E19 §2; [Duel's stated edge](#duels-stated-edge)). That source is not one of the rule's six places; the 0.1% in the game settings (E18) is, by Duel's description, the net edge after its rakeback, so it is noted, not tested (D3). The outcome is scored on Step 16 (BLACKJACK-19): pass, 0.000388 pp below the claim. A house-side miss would be an operator-origin FLAG on Step 16 and the verdict RTP FIGURE OVERSTATED, exit 5; a committed table that differs from the run exits 1.
- **Profile.** The Blackjack profile version this suite cites is 1.0.2 (decision D6, approved as cited; the `-draft` suffix is dropped, no check changed). In `outputs/verification-results.json` `profileCoverage.profileVersion` changed, and the BLACKJACK-19 notes on Steps 10 and 16 now say the stated edge is scored by the rule instead of compared in prose.
- **S5 level.** The adversarial matrix states the S5 level received: the fairness-integrity matrix; game-integrity testing was not commissioned (decision D5).
- **Exit 5** (RTP FIGURE OVERSTATED) is added to the exit codes.
- `outputs/rtp-claim-table.json` was written with `npm run rtp-claim:write` and pinned, `outputs/verification-results.json` regenerated with `PF_EMIT=1 npm run verify`, the release manifest now also hashes the table and was refreshed with `npm run release-manifest`, and `.gitignore` un-ignores the table. The mutation battery was rerun: 65/65 caught by their named step, 0 missed, 1 declared survivor, 38/38 scored steps covered.

### 19 October 2026 — wording before tagging

No step, figure, artifact or verdict changed; only README.md and this overview were edited.

- **The card code's origin.** `src/rng.ts` was then ported from Duel's published Verify-tab code; the overview and README were changed to say so plainly, and that it was not a rebuild from a specification. Superseded on 20 October 2026, below: `src/rng.ts` is now rebuilt from a written specification ([Card derivation](#card-derivation)). The RTP engine and the exact-rational oracle take no casino input and are unchanged.
- **Insurance and the second split.** The README and the conclusion now state that no hand was split a second time (46 split hands dealt a pair again, a split offered on none, none requested), next to the unfunded insurance (0 of 462 prompts). Both are disclosed in this release and are to be covered in the next capture (DL-3, R-INSURANCE, R-RESPLIT).
- **Release status.** The sentence calling the release a draft until tagged and signed was removed; v1.1.0's release manifest, in the copy at the `v1.1.0` tag, records the signing key's fingerprint.

### 20 October 2026 — card code rebuilt from a written specification (v1.2.0)

The verdict, the scored-step statuses (36 PASS, 2 capture-origin FLAGs, 0 hard fails), the dataset and the simulation artifacts are unchanged. Through v1.1.0, `src/rng.ts` was ported from Duel's published Verify-tab code (E17). A port can copy the casino's own mistake into the check of it, so the card code is now rebuilt from a written specification instead.

- **Specification.** [`docs/ALGORITHM.md`](docs/ALGORITHM.md), a copy of the ProvablyFair.org framework's `games/blackjack/ALGORITHM.md` (SHA-256 `ac7a8517…bb535`) with the spec author's workspace paths replaced by package paths or neutral wording (its header says so). It was written from Duel's public pages, the standard provably-fair construction and the 6,000 captured rounds, without opening Duel's code; its §4 gives the source of every step and its §8 lists every file read.
- **Rebuild.** `src/rng.ts` was written by an implementer who read only that specification and an interface file and never opened Duel's code or the earlier `src/rng.ts`. Its body is that implementer's file byte for byte; only a provenance header was added. Its self-test is now a unit test, `tests/blackjack/RngSpecTests.ts` (96/96).
- **Duel's code is a second check, not the source.** Step 38 and the unit tests still run Duel's Verify-tab file byte for byte on all 6,000 rounds: 300,000/300,000 cursors equal `src/rng.ts`, and the 5 fixed hash vectors agree, including the all-rejected throw. The 12-line citation table of the port (`OPERATOR_SOURCE_CITES`), its check in Step 38 and the unit tests, and mutation M38h are removed, so the registry holds 68 entries. M06, M35, M35b and M38k now edit the rebuilt code; M38f and M38g no longer rewrite a citation.
- **Three-way agreement.** Measured on integration over every captured round, replayed from its recorded actions: every served card 33,194/33,194 (player hands, split hands and dealer), hand values 6,269/6,269 and commitments 6,000/6,000 against the capture; 300,000/300,000 cursors against Duel's Verify-tab code; 144,000/144,000 cursors (0–23) against the live provablyfair.org verifier. On every `npm test`, Step 1 re-measures the commitments, Steps 5, 22 and 36 the served cards and Step 38 the two verifiers' cursors. No step was added.
- **Card helpers.** The rebuilt module refuses a malformed card, seed, nonce or cursor where the port accepted it; no captured or simulated input reaches that path.
- **Artifacts.** `npm run simulate:run` reproduced `outputs/simulation-results.json` and `outputs/rtp-convergence.html` byte for byte, so neither was re-pinned. `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify`: Step 38's detail no longer reports cited lines, and the BLACKJACK-09 and BLACKJACK-24 notes name the specification. The release manifest was written by `npm run release-manifest` as `v1.2.0-draft`, unsigned.
- **Battery (Apple M2 Max, 12 cores, Node v22.23.1).** The whole registry in one `npm run mutate`, 20 October 2026: 68/68 must-fail mutations caught by their named step, 0 missed, 1 declared survivor (S02), 38/38 scored steps covered.

### 21 October 2026 — final QA corrections (v1.2.0)

No step, figure, artifact of record or verdict changed.

- **Version labels.** The header of this overview and the README named the release `v1.2.0-draft`, and `package.json` / `package-lock.json` still said `1.1.0`; all now say `v1.2.0` / `1.2.0`. The release manifest's `release` field reads `v1.2.0` (it was `v1.2.0-draft`). The README and the v1.1.0 entry said the release manifest records the signing key's fingerprint; that is v1.1.0's manifest, in the copy at the `v1.1.0` tag, and both now say so.
- **Mutation record.** [Profile and mutation coverage](#reproduce-the-audit) cited the 28 September and 14–15 October runs as the ones the release manifest records; it records the run of 20 October 2026 (68/68, above), and now says so.
- **The 19 October entry** said the overview and README "now say" the card code is ported; that was true on 19 October and was superseded on 20 October, and the entry now says so.
- The release manifest was refreshed with `npm run release-manifest`.
- **Release wording.** At tagging, the README, this overview and the release manifest stopped describing `v1.2.0` as a draft until tagged. The release manifest records `v1.2.0`, superseding `v1.1.0`, and the fingerprint of the ProvablyFair.org signing key (`signature`, `SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`), as tagged `v1.2.0`; it was refreshed with `npm run release-manifest`. No check, figure or verdict changed.
