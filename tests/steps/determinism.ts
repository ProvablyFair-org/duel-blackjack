/**
 * Steps 5–6: Card recomputation in the declared draw order, and client-seed influence.
 *
 * Step 5 recomputes every visible card of every captured hand from (serverSeed, clientSeed, nonce,
 * cursor) and compares it with the card the casino served AT THAT CURSOR, in the declared order —
 * for split rounds too. Until 2026-09-24 split rounds were compared as a MULTISET of cursors
 * 0..N−1, so a post-split card served out of order passed; the order is now the Duel declaration
 * (src/round.ts declaredOrder):
 *
 *   unsplit  P1 D1 P2 D2 · player's extra cards in order · dealer's draws
 *   split    P1 D1 P2 D2 · H1 second card · H2 second card · H1 plays out · H2 plays out · dealer
 *
 * The population is the capture plan's (src/loader.ts EXPECTED_HANDS), never the dataset's own
 * length. Every draw's rejected-chunk count is accumulated for Step 35 (the draw-bias census).
 */

import { hmacSHA256, drawWithCensus, getCard } from '../../src/rng';
import { servedRound, declaredOrder } from '../../src/round';
import { EXPECTED_HANDS } from '../../src/loader';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 5: Card Recomputation (declared draw order) ────────────────────────
  {
    let verified = 0, mismatches = 0, skipped = 0, cursors = 0, splitVerified = 0, splitCursors = 0;
    let draws = 0, rejectedChunks = 0, exhausted = 0;
    const examples: string[] = [];

    for (const bet of ctx.bets) {
      const seed = ctx.seedMap.get(bet.server_seed_hashed);
      const s = servedRound(bet);
      if (!seed || !s) { skipped++; if (examples.length < 3) examples.push(`bet ${bet.id}: ${seed ? 'record unreadable' : 'seed unrevealed'}`); continue; }
      const o = declaredOrder(s);
      if ('error' in o) { mismatches++; if (examples.length < 3) examples.push(`bet ${bet.id}: ${o.error}`); continue; }
      let ok = true;
      for (let cursor = 0; cursor < o.seq.length; cursor++) {
        const d = drawWithCensus(hmacSHA256(seed, `${bet.client_seed}:${bet.nonce}:${cursor}`));
        draws++; rejectedChunks += d.rejected; if (d.card === null) exhausted++;
        if (d.card !== o.seq[cursor]) {
          ok = false;
          if (examples.length < 3) examples.push(`bet ${bet.id} nonce=${bet.nonce} cursor ${cursor}: served ${o.seq[cursor]}, seed gives ${d.card}`);
          break;
        }
      }
      if (ok) {
        verified++; cursors += o.seq.length;
        if (s.hands.length > 1) { splitVerified++; splitCursors += o.seq.length; }
      } else mismatches++;
    }

    ctx.drawCensus = { draws, rejectedChunks, exhausted };
    const splitRounds = ctx.bets.filter(b => (servedRound(b)?.hands.length ?? 0) > 1).length;
    const detail = `${verified}/${EXPECTED_HANDS} hands of record recompute card for card in the declared draw order ` +
      `(${cursors} cursors; ${ctx.bets.length} hands in the dataset). Split rounds in the declared split order ` +
      `P1 D1 P2 D2 · H1 second · H2 second · H1 plays · H2 plays · dealer: ${splitVerified}/${splitRounds} (${splitCursors} cursors) — strict, not a multiset. ` +
      `${mismatches} mismatches, ${skipped} skipped (a skipped hand is unverified and FAILS the step).`;
    results.push(step(5, 'Card Recomputation (declared draw order)',
      mismatches === 0 && skipped === 0 && verified === EXPECTED_HANDS && ctx.bets.length === EXPECTED_HANDS ? 'PASS' : 'FAIL',
      examples.length ? `${detail} Examples: ${examples.join(' | ')}` : detail,
      { verified, expected: EXPECTED_HANDS, cursors, splitVerified, splitRounds, mismatches, skipped }));
  }

  // ── Step 6: Client Seed Influence ───────────────────────────────────────────
  // The initial deal (cursors 0–3: P1, dealer up, P2, hole) of EVERY captured hand is re-derived
  // under two substitute client seeds: a wrong seed and the EMPTY seed (the control profile
  // BLACKJACK-06 asks for). Under the declared RNG the four cards are independent uniform draws, so
  // a substitute seed reproduces the served deal with probability 52^-4 per hand: expected
  // n / 52^4 = 0.0008 identical deals over 6,000 hands. The step FAILs if either substitute leaves
  // more than MAX_IDENTICAL deals unchanged (P(≥ 3 | Poisson 0.0008) ≈ 9e-11) — a casino ignoring
  // the client seed would leave all 6,000 unchanged — and if any hand could not be tested.
  {
    const SUBSTITUTES = ['wrong_seed_value_12345', ''];
    const MAX_IDENTICAL = 2;
    const P_SAME = 52 ** -4;
    let tested = 0, untested = 0;
    const identical = SUBSTITUTES.map(() => 0);
    for (const bet of ctx.bets) {
      const seed = ctx.seedMap.get(bet.server_seed_hashed);
      if (!seed) { untested++; continue; }
      tested++;
      const served = [0, 1, 2, 3].map(c => getCard(seed, bet.client_seed, bet.nonce, c)).join();
      SUBSTITUTES.forEach((cs, k) => {
        const sub = [0, 1, 2, 3].map(c => getCard(seed, cs, bet.nonce, c)).join();
        if (sub === served) identical[k]++;
      });
    }
    const expectedIdentical = tested * P_SAME;
    const passed = untested === 0 && tested === EXPECTED_HANDS && identical.every(n => n <= MAX_IDENTICAL);
    results.push(step(6, 'Client Seed Influence',
      passed ? 'PASS' : 'FAIL',
      `${tested}/${EXPECTED_HANDS} hands tested (${untested} untested). Initial deal (cursors 0–3) re-derived under a wrong client seed: ` +
      `${tested - identical[0]} changed, ${identical[0]} identical; under the EMPTY client seed (control): ${tested - identical[1]} changed, ${identical[1]} identical. ` +
      `Model: a substitute seed reproduces a deal with probability 52^-4, expected ${expectedIdentical.toExponential(2)} identical deals; FAIL above ${MAX_IDENTICAL} for either substitute (0 % change would be 6,000 identical).`,
      { tested, untested, identicalWrongSeed: identical[0], identicalEmptySeed: identical[1], expectedIdentical, maxIdentical: MAX_IDENTICAL }));
  }

  return results;
}
