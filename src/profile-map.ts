/**
 * Which ProvablyFair.org Blackjack profile check each scored step implements.
 *
 * WHY THIS FILE EXISTS. The framework's Blackjack game profile (Framework 1.1, profile 1.0.2)
 * declares checks BLACKJACK-01 … BLACKJACK-30. This suite scores 38 steps under its own numbering,
 * which the chapters cite by number and which therefore cannot be renumbered to match. The mapping
 * is declared here, emitted into outputs/verification-results.json beside the step results, and read
 * back by `pf-audit matrix`, which prints the conformance matrix.
 *
 * THIS FILE LABELS; IT DOES NOT CHECK. Nothing here can make a step pass or fail. The rule is the
 * profile's own `asserts` text: a check is claimed `full` only if the step's assertion decides it AND
 * the step's failing branch is reachable — every `full` below cites the mutation in
 * tests/mutations.json (`npm run mutate`, run in a throwaway copy) whose FAIL line proves it.
 *
 * COVERAGE DESCRIBES THE PACKAGE, NOT THE STEP.
 *   full    — nothing the profile's `asserts` requires is unimplemented; where a check is split
 *             across steps every one says `full` and each note says which half it carries.
 *   partial — something the profile requires is implemented nowhere in this package; the note says
 *             what, and classifies the gap: CODE (not built), or CAPTURED BEFORE THE STANDARD (the
 *             capture of 30 Apr – 1 May 2026 predates the 23 Sep profile and does not hold the data
 *             the rule asks for — disclosed in MANIFEST.md, not a recapture request).
 * One check is n/a by the declaration's predicate: BLACKJACK-16 (no balance field).
 *
 * EVERY COUNT BELOW was produced by `npm run verify` on 2026-09-24 against the pinned dataset
 * (sha256 55d4b4b1…, meta.token removed) and the pinned simulation artifact (d1e4e4cf… since the second
 * round of 2026-09-24, which added Pass 2 Test C and changed none of the 1,027 earlier values).
 */

export type Coverage = 'full' | 'partial';
export interface CheckClaim { id: string; coverage: Coverage; note?: string }
export interface StepClaims { claims: CheckClaim[]; reason?: string }

export const PROFILE_GAME = 'blackjack';
export const PROFILE_VERSION = '1.0.2';

const full = (id: string, note: string): CheckClaim => ({ id, coverage: 'full', note });
const part = (id: string, note: string): CheckClaim => ({ id, coverage: 'partial', note });

// Notes shared by every step that carries a split check, so the steps cannot disagree.
const N05 = (half: string) => `${half}. Population from code (src/loader.ts: 6,000 hands, 121 seed records, 120 epochs of 50, `
  + 'A 3,300 / B 1,000 / C 500 / D 500 / E 200 / F 500) and per-phase stakes from src/config.ts PHASE_STAKE; Steps 1, 5, 6 and 7 '
  + 'now bind to EXPECTED_* instead of the dataset length. FAIL probed: M12 (epoch size 49), M13 (shrunken dataset re-pinned), M33 (Phase E stake $10.50)';
const P06 = (half: string) => `${half}. MISSING — CAPTURED BEFORE THE STANDARD: the profile requires the Phase A–C client-seed generator to be a `
  + 'CSPRNG; the capture script generated them with Math.random() (capture/capture.reference.js generateClientSeed), disclosed as MANIFEST.md DL-2. '
  + 'Everything else is implemented: 6,000/6,000 initial deals change under a wrong seed AND under the empty-seed control (model 52^-4, '
  + '0 identical), all 500 Phase D hands recompute in full under 10 auditor seeds, the fixed pfaudit_bj_seed00…09 seeds disclosed with the '
  + '10 exposed epochs enumerated in Step 15. FAIL probed: M06 (client seed dropped from the HMAC), M15 (a Phase D seed swapped, re-pinned)';
const N07 = (half: string) => `${half}. Every hand recomputes card for card from (serverSeed, clientSeed, nonce, cursor) in the DECLARED order — split rounds `
  + 'strictly in the Duel declaration P1 D1 P2 D2 · H1 second · H2 second · H1 plays · H2 plays · dealer (src/round.ts declaredOrder; it was a cursor '
  + 'multiset until 2026-09-24): 6,000/6,000 hands, 33,194 cursors, 269/269 split rounds, coverage bound to EXPECTED_HANDS, a skip FAILs. '
  + 'FAIL probed: M05 (hand 2\'s second card declared first — a multiset passed it), M22 (hand 2 plays before hand 1)';
const N10 = (half: string) => `${half}. The four legs: initial deal 2 + 2 with the hole face-down (Step 32, 6,000/6,000); S17 in both directions with the `
  + 'exemptions counted from the cards (Step 19: 4,216 dealer play-outs compliant, 1,784 exempt rounds with exactly two dealer cards, 75 soft-17 stands, '
  + '0 hits); peek (Step 36: 574 rounds ended at the deal on a natural, no player action consumed); the action stream (Step 36: every round replayed '
  + 'from the seed and its tokens alone reproduces every served hand, has_doubled flag and dealer hand, 6,000/6,000; grammar — insurance token first '
  + 'and iff an Ace, split only at the head on a rank pair, double only as a hand\'s first action, no token after the round, no hand below 21 left '
  + 'without a terminal — 0 violations; 8,313 per-response player card counts equal the replay state; hit + double tokens = extra cards 6,000/6,000); '
  + 'action vocabulary (Step 28). FAIL probed: M19, M28, M32, M36 (relabelled token stream, re-pinned), M36b (replay without auto-stand)';
const N11 = (half: string) => `${half}. Money is EXACT on the declared 18-decimal grid (src/money.ts): amounts parsed to 1e-18 integer units, multipliers `
  + 'to exact rationals, zero tolerance (it was parseFloat at ±1e-6, then relative 1e-12). Step 7: amount_won == stake × Σ per-hand returns derived '
  + 'from the cards + side returns derived from the cards and the declared paytable, 6,000/6,000 with 0 residual; insurance_taken is false on every '
  + 'round so its term is 0 (a taken insurance FAILs). On-grid sweep: 82,400/82,400 money strings. Step 26: every served side payout == served '
  + 'multiplier × stake exactly (5,800 + 5,800). FAIL probed: M07 (amount_won nudged by one 1e-18 unit, re-pinned), M07c (19-decimal amount), '
  + 'M26 (side payout off by 1e-10, re-pinned)';
const P13 = (half: string) => `${half}. MISSING — CAPTURED BEFORE THE STANDARD: insurance 2:1 "on funded insurance bets" is ASSUMED, not verified — witness count 0 funded `
  + 'of 462 prompts (the capture declined every one; floor 100), Step 37 FLAG (capture origin), MANIFEST.md DL-3. Everything else is derived from the recomputed cards '
  + '(src/round.ts settleRound): 6,269 hands settled and the operator label reconciled on every one (0 disagree); 3:2 isolated (Step 20: 260 naturals '
  + 'at exactly 2.5 ×, 17 natural-vs-natural pushes at 1 ×); doubled hands at 2 × (Step 21: 1,368 hands); split hands per hand (Step 24: 269/269); '
  + 'a two-card 21 after a split settles as a total, witnessed 30/30. FAIL probed: M07b (relabelled result, re-pinned), M20 (3:2 downgraded), M21, M24';
const N14 = (half: string) => `${half}. Categories re-derived from the recomputed P1, P2 and up-card (Step 8, served multiplier == declared paytable as exact `
  + 'rationals, 5,800 + 5,800); every paytable category exercised (Step 11 FLAGs a published category never observed — none); payout == paytable × '
  + 'stake exactly (Step 26); invariant to later play, deal vs final (Step 27); side stake == main stake (Step 31, 5,800 + 5,800); snapshot = the two '
  + 'initial player cards + up-card before any split; NO forfeit on split, measured: 307/307 winning side bets on split rounds still paid at '
  + 'settlement (Step 27). FAIL probed: M08, M11, M26, M27, M31';
const N17 = (half: string) => `${half}. Deck model: infinite, confirmed by repeated rank+suit within the initial four cursors against the with-replacement `
  + 'expectation (Step 29). Hole card: never exposed before settlement — the pre-settlement sweep over all 8,313 captured deal and action responses '
  + '(Step 32) finds 0 face-down cards carrying a rank or suit, 0 dealer values counting the hole card, and 0 responses containing the round\'s server '
  + 'seed. Mid-round rotation (can a rotation reveal the active seed before the remaining cards are dealt?) was not probed live: declared as '
  + 'MANIFEST.md DL-5 with its closing production item. FAIL probed: M29, M32 (hole card rank leaked, re-pinned)';
const P19 = (half: string) => `${half}. MISSING — NOT SCORED: the served effective_edge reads 0.1 on every record; `
  + 'it is not applied to the hand, and it reads the same 0.1 % as the net edge after rakeback in Duel\'s description, not the game\'s edge '
  + '(MANIFEST.md Duel\'s edge model; DL-7 closed). The 0.57 % edge a Duel staff member has stated (99.43 %) is held to the exact optimal-play RTP per initial bet by the RTP-CLAIM rule 1.2.0 (src/rtp-settings.ts, outputs/rtp-claim-table.json, scored on Step 16 since 2026-10-14, Methodology v1.1 D4): PASS, 99.429612 %, inside the 0.1 pp band. Implemented: RTP 99.4296 % per initial bet and 99.4939 % per total wagered with the same strategy\'s average wager '
  + '1.126935 (src/optimal-play.ts computeAverageWager, 0 action ties); side-bet edges by exact enumeration of the declared paytable, the one the captured $0.01 side bets were paid at (Perfect Pairs exactly 0; 21+3 '
  + '16/1406080000000; other stakes not captured); every served effective_edge asserted equal to the constant (Step 10). FAIL probed: M10';

/** Scored step number → the profile checks it implements. Every step 1..38 has an entry. */
export const STEP_CLAIMS: Record<number, StepClaims> = {
  1: { claims: [full('BLACKJACK-01', 'every revealed seed hashes to its commitment under SHA-256(hex-decoded bytes); verified count must EQUAL '
    + 'EXPECTED_EPOCHS = 120 (src/loader.ts), not a dataset count, and every seed record that carries a seed (attached after the capture) is checked. Measured 120/120, '
    + '0 failures. FAIL probed: M01 (a forged reveal, dataset re-pinned)')] },
  2: { claims: [part('BLACKJACK-02', 'MISSING — CAPTURED BEFORE THE STANDARD: the profile requires a pre-capture link that anchors the chain '
    + 'before epoch 0. The capture reference reads the active seed\'s next hash before the first rotation, compares it in memory with the hash that '
    + 'rotation makes active and then overwrites it (capture/capture.reference.js lines 426–444); the dataset holds no link before epoch 0. seeds[0], the rotation that opened epoch 0, was recorded inside the capture (2026-04-30T21:31:23.099Z, '
    + '0.834 s after meta.createdAt) in the same whole second as the epoch\'s first bet (created_at 21:31:23), capture clock against operator clock '
    + '(MANIFEST.md, Pre-bet commitment evidence). Implemented: raw links seeds[i].nextServerSeedHash == seeds[i+1].serverSeedHashed, 120/120, count bound to '
    + 'EXPECTED_SEEDS − 1 (the last is the forward commitment after the final rotation); no capture-script boolean exists or is read; '
    + 'seeds[0] was recorded no later than the first of its epoch\'s bets settled (one-second resolution). FAIL probed: M02 (one next-hash '
    + 'zeroed, re-pinned)')] },
  3: { claims: [full('BLACKJACK-03', 'epochs derived from transaction-id order and the rotation timeline, not from the hash field; every '
    + 'bet in window k carries seeds[k]\'s hash, client seed and phase and settles inside its window: 120/120 epochs, 6,000/6,000 bets. FAIL '
    + 'probed: M03 (a rotation timestamp moved, re-pinned)')] },
  4: { claims: [part('BLACKJACK-04', 'MISSING — CAPTURED BEFORE THE STANDARD: the window cannot close against an auditor-recorded nonceEnd '
    + 'because the capture recorded none (seeds[].nonce is 0 on every rotation record); it is closed against the plan instead (base + 50 + '
    + 'declared gaps − 1, 120/120), so a game played after an epoch\'s last captured nonce would not be seen (MANIFEST.md DL-1). Implemented: '
    + 'declared base 0, no repeat, order by transaction id, and a REGISTER of the 7 capture-retry gaps (src/loader.ts, each with its re-measured '
    + 'evidence — a settlement-clock gap of 14–40 s against a 3 s median) → FLAG origin capture; a gap not in the register is operator-side → FAIL; '
    + 'a stale row FAILs. FAIL probed: M04 (a register row removed), M04b (declared base 1)')] },
  5: { claims: [full('BLACKJACK-07', N07('Step 5 carries every hand')), full('BLACKJACK-05', N05('Step 5 binds its coverage to EXPECTED_HANDS'))] },
  6: { claims: [part('BLACKJACK-06', P06('Step 6 carries the wrong-seed sample and the empty-seed control'))] },
  7: { claims: [full('BLACKJACK-11', N11('Step 7 carries the round sum and the on-grid sweep')), part('BLACKJACK-13', P13('Step 7 carries the settlement of every hand and the label reconciliation')), full('BLACKJACK-05', N05('Step 7 binds to EXPECTED_HANDS'))] },
  8: { claims: [full('BLACKJACK-14', N14('Step 8 carries category provenance'))] },
  9: { claims: [full('BLACKJACK-12', 'all 200 Phase E ($10, 1,000 × the $0.01 base) hands recompute card for card in the declared order (split '
    + 'rounds strict) and settle by the same rules from the same cards; the stake is not an HMAC input. FAIL probed: M09 (plan says 201)')] },
  10: { claims: [part('BLACKJACK-19', P19('Step 10 carries the served-label assertion and the stated reconciliation'))] },
  11: { claims: [full('BLACKJACK-14', N14('Step 11 carries category completeness'))] },
  12: { claims: [full('BLACKJACK-05', N05('Step 12 carries every epoch = exactly 50'))] },
  13: { claims: [full('BLACKJACK-05', N05('Step 13 carries hands, seeds and per-phase counts'))] },
  14: { claims: [full('BLACKJACK-26', 'dataset SHA-256 pinned in src/loader.ts and enforced before any step (abort on mismatch) and again here; '
    + 'the side-bet paytable single-sourced in src/config.ts (it was a literal in three files) and the dataset\'s own config.multipliers block '
    + 'scored against it, 8/8 entries as exact rationals; THE RULE SET IS SINGLE-SOURCED (2026-09-24): src/config.ts RULES is derived once into '
    + 'RULES_IN_EFFECT, which the replay and settlement (src/round.ts), the engine (src/optimal-play.ts defaults), the simulator (src/sim-hand.ts) '
    + 'and Steps 19 and 20 read — the literal `< 17` dealer loop, the `\'stand\', true` engine defaults, the simulator\'s own SOFT17_RULE / '
    + 'DAS_ALLOWED and the literal 2.5 are gone; a RULES value the code cannot play throws at load; Step 14 FAILs when the engine\'s solved rules or '
    + 'the pinned simulation\'s recorded rules differ from RULES. FAIL probed: M14 (served paytable says flush pays 6, re-pinned), M14b (RULES says '
    + 'the dealer hits soft 17 → Step 14 FAIL: the pinned simulation ran under soft17 stand, RULES says hit)')] },
  15: { claims: [part('BLACKJACK-06', P06('Step 15 carries the full Phase D recompute and the predictable-seed disclosure'))] },
  16: { claims: [
    full('BLACKJACK-18', 'the recursive infinite-deck engine reads no operator figure (only RULES and the rank distribution). EXACT-RATIONAL '
      + 'ORACLE: anchor/oracle.py (Python standard library, Fractions, 13 distinct ranks so split-by-rank is exact, concrete hole cards with the '
      + 'peeked naturals removed, written from RULES without reading the engine) prints 7016161098045143337706614398/7056410014866816666030739693 '
      + '= 99.4296119877 % (S17) and 99.2107894950 % (H17); pinned in src/config.ts ORACLE_RTP; Step 16 requires the engine within 1e-12 under both '
      + '(measured |Δ| 1.2e-15 and 8.9e-16) and a mocha test re-runs the oracle and compares the fractions. The deck is infinite, so a reduced-shoe '
      + 'oracle is the same object as this one. RECORDED EXTERNAL REFERENCES, dated and primary (since 2026-09-25): two Wizard of Odds '
      + 'infinite-deck pages read 2026-09-25, cited by a SHA-256-pinned citation carrying the URL, read date, the page\'s hash as read and the '
      + 'figure\'s sentence verbatim (evidence E14, E15; src/config.ts EXTERNAL_RTP_REFERENCES; the pages were vendored until 2026-09-28); '
      + 'Step 16 reads each figure OUT OF the cited sentence and the same engine under that page\'s stated rules reproduces it to half a unit of its '
      + 'last printed digit — E14 player EV -0.511734 % (S17, DAS, split to four hands except aces, one card to split aces): engine -0.51173364 %, '
      + '|Δ| 3.6e-9 ≤ 5e-9; E15 house edge 0.5093975 % (same, unlimited re-splitting): engine 0.50939746 %, |Δ| 4.4e-10 ≤ 5e-10. Both pages '
      + 're-split and Duel does not, so the engine gained a re-split limit used ONLY for these references (Duel\'s headline is bit-identical, '
      + '0.994296119877263 before and after). The pages\' unstated rules (3:2, peek on ace and ten, natural pushes, split 21 at 1:1, aces not '
      + 're-split, S17) are each flipped and each moves the figure outside the tolerance (0.0587–2.2548 pp), so the agreement discriminates. '
      + 'The 99.4296 % recorded until 2026-09-25 as "Wizard of Odds for Duel\'s exact rules" (undated) was not found on the 48 Wizard of Odds '
      + 'pages read that day (evidence E16) and is retired as a reference — it is this engine\'s own figure (MANIFEST.md, Errata — 25 September '
      + '2026). NEGATIVE CONTROL: the same engine under H17 gives 99.2108 %. FAIL probed: M16 (engine ignores its S17 input), M16c (card weights '
      + 'off by 2e-9, caught by the oracle: |Δ| 5.4e-11), M16d (E14 citation\'s quoted figure edited one printed unit and re-pinned: |Δ| 1.4e-8 > 5e-9), M16e (E15 '
      + 'citation edited, not re-pinned), M16f (engine stops re-splitting: E14 |Δ| 5.9e-4), M16g (engine ignores the peek toggle: the ace-only flip moves '
      + '0.0000 pp — "a flip stays INSIDE the tolerance")'),
    part('BLACKJACK-19', P19('Step 16 carries both RTP conventions, the average wager and the exact side-bet edges')),
  ] },
  17: { claims: [full('BLACKJACK-20', '10 streams × 1,000,000 hands from the pinned SIM_SEEDS through src/rng.ts and the declared strategy; '
    + 're-derived in verify from the rows: per-stream RTP vs the engine at each row\'s own standard error (Fisher p = 0.686432), serial '
    + 'independence (0/10 at Bonferroni), and — new — first-card rank uniformity from each row\'s census (0/10 below 0.001, χ² 12 df). The '
    + 'committed experiment reproduces byte for byte: `npm run simulate:run` and `npm run simulate` wrote identical bytes on 2026-09-24 and all '
    + '647 values of the previous artifact were unchanged. FAIL probed: M17 (Fisher p hand-written, re-pinned), M17b (forged first-card census)')] },
  18: { claims: [full('BLACKJACK-21', 'every revealed seed (120, bound to EXPECTED_EPOCHS) × 10,000 nonces. TEST C, the verdict-bearing statistic '
    + '(src/cherry-pick.ts, rule fixed before the rows were generated): the money return of the declared strategy (src/sim-hand.ts, the one Pass 1 '
    + 'plays) in the SERVED window — exactly the capture\'s own 50 nonces per seed, taken from the dataset in verify (7 epochs with a capture-retry '
    + 'gap) — ranked against the seed\'s own 199 other windows of 50, an empirical block null (every hand has the same mean and variance under one '
    + 'strategy, so standardising the sum would not change a rank); ONE-SIDED, pre-registered: p = (1 + rank)/200, flag at p < 0.05 (rank ≤ 8, null '
    + 'flag probability 0.045), FAIL above N·0.045 + 5σ + 1 = 17.75; measured 7/120 (smallest p 0.010). EVERY WINDOW IS RE-DERIVED IN VERIFY: '
    + 'all 120 × 10,000 hands replayed from the revealed seeds, rows equal the replay 120/120. SECONDARY SCREEN: first-card rank uniformity per '
    + 'seed, 0/120 below 0.001. DETECTION POWER against an attacker serving the lowest-returning of K candidate windows, measured on the replayed '
    + 'windows and printed with the result (per seed K=2 0.125, K=5 0.200, K=10 0.333, K=20 0.467; audit-level at f = 0.5 of seeds picked: '
    + '0.013 / 0.214 / 0.890 / 0.998). Test B (the original two-sided z-test, 11/120, binomial p 0.038450) is kept and re-derived so its '
    + 'published figures stay traceable. FAIL probed: M18 (a Test B flag flipped, re-pinned), M18c (a flagged seed\'s served window raised and '
    + 'its rank/flag/summary made consistent, re-pinned → 117 rows differ from the replay), M18d (verify takes nonces 50–99 as the served window)')] },
  19: { claims: [full('BLACKJACK-10', N10('Step 19 carries the S17 leg'))] },
  20: { claims: [part('BLACKJACK-13', P13('Step 20 carries the isolated 3:2 check'))] },
  21: { claims: [part('BLACKJACK-13', P13('Step 21 carries doubled hands'))] },
  22: { claims: [full('BLACKJACK-07', N07('Step 22 re-asserts the split rounds on their own'))] },
  23: { claims: [full('BLACKJACK-15', 'Step 23 carries the split-rule witnesses (rank pairs only, no re-split, split aces one card) that Step 37\'s '
    + 'register cites. FAIL probed: M23')] },
  24: { claims: [part('BLACKJACK-13', P13('Step 24 carries split hands settled per hand and the two-card-21-after-split witness'))] },
  25: { claims: [full('BLACKJACK-15', 'Step 25 carries the insurance OFFER rule (both directions: every Ace up-card prompted, no prompt otherwise, '
    + 'insurance_available agrees on 6,000/6,000). FAIL probed: M25')] },
  26: { claims: [full('BLACKJACK-14', N14('Step 26 carries the exact side payout')), full('BLACKJACK-11', N11('Step 26 carries the side-bet money'))] },
  27: { claims: [full('BLACKJACK-14', N14('Step 27 carries deal-vs-final invariance and the no-forfeit-on-split witness'))] },
  28: { claims: [full('BLACKJACK-10', N10('Step 28 carries the action vocabulary'))] },
  29: { claims: [full('BLACKJACK-17', N17('Step 29 carries the deck model'))] },
  30: { claims: [full('BLACKJACK-22', 'first-card rank vs uniform over the 6,000 recomputed deals (χ² 8.587, 12 df, p = 0.7377), player naturals '
    + '277 and dealer naturals 314 vs 8/169 (z −0.43 and 1.82), a deviation below p 0.001 or beyond |z| 4 is INFO (policy INFORMATIONAL, Mike 2026-09-29: '
    + 'reported, never counted, verdict unchanged); the money-path return '
    + '91.4309 % is labelled a reconciliation of this capture, not an RTP. INFO probed: M30')] },
  31: { claims: [full('BLACKJACK-14', N14('Step 31 carries the side-stake relation'))] },
  32: { claims: [full('BLACKJACK-10', N10('Step 32 carries the initial deal structure')), full('BLACKJACK-17', N17('Step 32 carries the hidden-state sweep'))] },
  33: { claims: [full('BLACKJACK-05', N05('Step 33 carries the per-phase stakes')), full('BLACKJACK-15', 'Step 33 carries "observed stakes fall '
    + 'inside the declared brackets", exact on the grid. FAIL probed: M33')] },
  34: { claims: [full('BLACKJACK-27', 'both artifacts the report quotes (outputs/simulation-results.json, outputs/rtp-convergence.html) are pinned '
    + 'in src/artifact-pins.ts and un-ignored by name in .gitignore; neither carries run metadata (generatedAt removed 2026-09-24); verify writes '
    + 'only to outputs/run/ (the committed verification-results.json is refreshed only by PF_EMIT=1 and guarded by the field-diff reproduction '
    + 'gate); the chart is self-contained inline SVG (it loaded Chart.js from a CDN) and the step FAILs a pinned HTML that references anything '
    + 'external; every one of the 26,467 numeric leaves of the JSON artifact lies in the domain src/domains.ts declares (bounds from code), an '
    + 'undeclared leaf FAILs; regeneration reproduced the committed bytes exactly. FAIL probed: M34 (edited, not re-pinned), M34b (impossible '
    + 'value, re-pinned), M34c (CDN script back in the chart, re-pinned)')] },
  35: { claims: [full('BLACKJACK-08', 'computed bound, printed: MAX_FAIR = 4,294,967,248 = 52 × 82,595,524, the largest whole number of ranges '
    + '(2^32 − MAX_FAIR = 48 < 52), so the bias per accepted draw is exactly 0 ≤ 2^-32; rejection census over the 33,194 captured draws: 0 rejected '
    + 'chunks against 3.71e-4 expected, 0 exhausted hashes. The rejection branch is honestly unwitnessed in the capture (MANIFEST.md DL-4); its code '
    + 'path is exercised by tests/blackjack/FrameworkTests.ts. FAIL probed: M35 (not the largest multiple), M35b (not a whole number of ranges)')] },
  36: { claims: [full('BLACKJACK-10', N10('Step 36 carries the replay, the grammar, peek and the per-response counts'))] },
  37: { claims: [full('BLACKJACK-15', 'every declared rule marked observed with its witness count or ASSUMED: S17, peek, split by rank (438 offers, '
    + '0 on a non-pair), split aces one card (34), DAS (109), double on any two (766 doubles outside 9–11), no re-split (46 re-paired split hands, '
    + 'split never re-offered), no surrender (0 of 14,313 action lists), insurance offered on every Ace (462) — insurance 2:1 ASSUMED, 0 funded; '
    + 'floors splits 269/200, ace splits 34/20, DAS 109/100, doubles 1,368/500, funded insurance 0/100 → FLAG (origin capture) with MANIFEST.md '
    + 'DL-3; 7 uncaptured games counted (Step 4); a rule the data contradicts FAILs. FAIL probed: M37 (RULES declares no double after split — contradicted by 109 captured split rounds with a double; a declared re-split or surrender now stops the suite at load, src/config.ts rulesInEffect)')] },
  38: { claims: [full('BLACKJACK-24', 'the docs-site verifier (VerifyBets games/blackjack/derive.js 1c20b41c… + lib/hmac-sha256.js bc30bfe9…, re-vendored 2026-09-25 from the site\'s origin/main @ bd4d59c; the earlier repotree-sync @ 2ad89bc bytes differed only in the source-URL comment) is '
    + 'HASH-MATCHED (src/site-verifier.ts; scripts/check-site-verifier.mjs against main\'s files read with git cat-file: both MATCH, exit 0) '
    + 'and EXECUTED on all 6,000 rounds, replaying the actions itself: cards, outcomes, doubled flags, gross returns, dealer hands and side-bet '
    + 'multipliers equal this package\'s on 6,000/6,000. The LIVE www.provablyfair.org/verify-bets bundle (3 chunks + runner, src/live-site-'
    + 'verifier.ts; `check-site-verifier.mjs --live` GET 2026-09-24: 3/3 MATCH) is executed on all 6,000: its 24 printed cursors equal src/rng.ts '
    + 'and the served cards, 6,000/6,000. Duel\'s own Verify-tab code (the page\'s code panel, copied 2026-09-25, pinned, src/operator-verifier.ts) is '
    + 'executed on all 6,000 as a third leg, a second check on src/rng.ts (rebuilt from docs/ALGORITHM.md, not from Duel\'s code), not its source: 300,000/300,000 cursors equal src/rng.ts (profile BLACKJACK-09); the live Verify button itself is not '
    + 'probed (MANIFEST.md DL-6). FAIL probed: M38 '
    + '(vendored derive.js split order changed, re-pinned), M38b (edited, not re-pinned), M38c (live chunk reads cursor+1, re-pinned), M38d–M38g, M38i '
    + '(operator leg)')] },
};

export const NOT_APPLICABLE = [
  { id: 'BLACKJACK-16', reason: 'money.balanceField is null: no record carries a wallet balance (deal and final carry amount_currency and amount_won only), so there is no consecutive-hand delta to reconcile; the stake side of the money path is declared unobservable (MANIFEST.md DL register)' },
];

export const PACKAGE_CHECKS = [
  { id: 'BLACKJACK-09', artifact: 'evidence/verify-tab/duel-verify-tab-blackjack-2026-09-25.js + src/operator-verifier.ts + src/rng.ts + docs/ALGORITHM.md + tests/blackjack/FrameworkTests.ts + tests/blackjack/BlackjackTests.ts + Step 38', coverage: 'full',
    note: 'VENDORED OPERATOR CODE, A SECOND CHECK (since 2026-09-25; second check only since v1.2.0, 2026-10-20): src/rng.ts is rebuilt from the '
      + 'written specification docs/ALGORITHM.md by an implementer who never opened Duel\'s code, and is not ported from this file. Duel\'s own Blackjack verification code, copied by Paulo from duel.com → Provably Fair → '
      + 'Verify (code panel) on 2026-09-25 and saved verbatim (SHA-256 1dabca2a…fe16b2, pinned in src/operator-verifier.ts; MANIFEST.md#evidence E17), is '
      + 'EXECUTED UNMODIFIED (function wrapper, Node WebCrypto; runner pinned) by a unit test and by Step 38 on every captured hand from its revealed '
      + 'seed: 6,000/6,000 hands, 300,000/300,000 cursors (0 … 49) equal src/rng.ts, 33,194/33,194 served cards in the declared order equal its '
      + 'cursors. FIXED VECTORS through the operator\'s own code: the known captured hand (nonce 0, all 50 cursors) and five hash vectors for the '
      + 'branches no captured round reaches — rejection at MAX_FAIR, acceptance at MAX_FAIR − 1, seven rejections, all eight rejected (both throw), '
      + 'big-endian read. The 12-line citation table of the v1.1.0 port (OPERATOR_SOURCE_CITES) was removed with the port on 2026-10-20. The commitment encoding (SHA-256 of the hex-decoded seed) is not in the operator file and '
      + 'rests on the capture (Step 1). FAIL probed: M38d (message reads cursor+1, re-pinned), M38e (edited, not re-pinned), M38f (bound 2^32, '
      + 're-pinned — only the hash vectors catch it), M38g (little-endian, re-pinned), M38i (runner passes nonce+1, re-pinned), M38j (mocha: the unit test fails). NOT established: that the live Verify button runs the '
      + 'code its panel shows, or that Duel\'s server runs it (MANIFEST.md DL-6)' },
  { id: 'BLACKJACK-23', artifact: 'MANIFEST.md#verification-results (S5-MATRIX block)', coverage: 'full',
    note: 'MANIFEST "Verification results" carries the framework\'s standardized matrix S5-1 … S5-8 between S5-MATRIX markers, each row Not tested (the capture '
      + 'recorded normal play and sent no adversarial request) and tied to what the steps do show and to MANIFEST.md DL-8; this audit\'s own '
      + 'offline checks keep their own ids (S-1 …)' },
  { id: 'BLACKJACK-25', artifact: 'MANIFEST.md#verify-a-bet', coverage: 'full',
    note: 'MANIFEST "Verify a bet" states in order where the seed is revealed, which fields to copy (server_seed_hashed, client_seed, nonce, server_seed — the '
      + 'declaration\'s names), the commitment encoding (SHA-256 of the hex-decoded seed), the draw (HMAC-SHA256, uint32 rejection, CARDS[v mod 52]), '
      + 'the deal order and the split order; its pasteable script was run on 2026-09-24 against a captured split round' },
  { id: 'BLACKJACK-28', artifact: 'package.json + package-lock.json + tests/verify.ts + .nvmrc + README.md + MANIFEST.md', coverage: 'full',
    note: 'FRESH CLONE MEASURED 2026-09-24 (Node 22.23.1): a fresh clone of the workshop with this package\'s working tree laid over it; '
      + '`npm ci --offline` from the local npm cache (registry not contacted) exit 0; `npm test` = mocha + verify: 74 passing, 36/38 PASS + 2 '
      + 'capture-origin FLAGs, PROVABLY FAIR — Full Pass, REPRODUCED, exit 0, 25 s; `npm run test:full` regenerated into outputs/run/ and '
      + 'field-diffed against the committed artifacts (1e-14 + 1e-12 rule): 0 differences on both, runtime 22.23.1 in outputs/run/diff.json, '
      + 'exit 0, 167 s, and the regenerated JSON and chart equal the committed bytes; SHA-256 of every pinned artifact and the dataset unchanged '
      + 'after both runs. Operator FLAG exits 2; audit ID PF-2026-DL09 emitted into the results; engines 22.x + .nvmrc; step counts 38 in '
      + 'README and MANIFEST. NOT measured: an npm ci that downloads from the registry' },
  { id: 'BLACKJACK-29', artifact: 'tests/mutations.json + tests/survivors.json + tests/mutations.ts (npm run mutate)', coverage: 'full',
    note: 'a step-named registry run serially in throwaway copies: every one of the 38 scored steps has at least one mutation that kills it BY NAME; '
      + 'forged-evidence battery included — relabelled result (M07b), shrunken dataset (M13), hand-written simulation block (M17, M17b, M18, M34b), '
      + 'downgraded 3:2 (M20), off-grid perturbation (M07, M07c), a forged external-reference citation (M16d), a forged operator Verify-tab file (M38d, M38f, M38g), each forged file RE-PINNED by the runner as a forger would; one declared survivor '
      + 'tied to DL-3 (S02); the former survivor S01 (all-rejected branch returns a card) is caught since 2026-09-25 by the operator-code hash vector V4 (M38k, Step 38)' },
  { id: 'BLACKJACK-30', artifact: 'MANIFEST.md#limitations-and-trust (Declared Limitations DL-1 … DL-11, Load-Bearing Premises) + MANIFEST.md#evidence (E01 …)', coverage: 'full',
    note: 'MANIFEST.md carries the declared-limitations register with measured magnitudes and closure evidence and a Load-Bearing Premises table '
      + 'marking the unwitnessed premises ASSUMED; MANIFEST Evidence numbers every exhibit from E01 with its role; the capture session\'s security token '
      + '(meta.token) was removed from the dataset and the empty internal results/ directories no longer ship' },
];

export function profileCoverageBlock(): Record<string, unknown> {
  return { game: PROFILE_GAME, profileVersion: PROFILE_VERSION, notApplicable: NOT_APPLICABLE, packageChecks: PACKAGE_CHECKS };
}

export function labelFor(step: number): Record<string, unknown> {
  const entry = STEP_CLAIMS[step];
  if (!entry) return { profileIds: [], profileChecks: [], profileNote: 'no mapping declared for this step' };
  return entry.claims.length
    ? { profileIds: entry.claims.map(c => c.id), profileChecks: entry.claims }
    : { profileIds: [], profileChecks: [], profileNote: entry.reason ?? 'no reason given' };
}
