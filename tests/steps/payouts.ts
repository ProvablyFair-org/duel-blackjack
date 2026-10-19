/**
 * Steps 7–9: Settlement from the cards (exact money), multiplier provenance, bet-size invariance.
 */

import { getCard } from '../../src/rng';
import { classifyPerfectPairs, classifyTwentyOnePlus3 } from '../../src/sidebets';
import { PP_PAYTABLE, T3_PAYTABLE, PP_KEY, T3_KEY } from '../../src/config';
import { toUnits, toRational, mulUnits, exactEquals, addRational, rationalToString, type Rational } from '../../src/money';
import { servedRound, declaredOrder, recomputedHands, settleRound } from '../../src/round';
import { EXPECTED_HANDS, EXPECTED_PHASE_HANDS } from '../../src/loader';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

/** Every money string a record carries, with where it came from — the on-grid sweep reads all of them. */
export function moneyFields(b: any): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [
    ['amount_currency', b.amount_currency], ['amount_won', b.amount_won],
    ['deal.amount_currency', b.deal?.amount_currency], ['deal.amount_won', b.deal?.amount_won],
    ['final.amount_currency', b.final?.amount_currency], ['final.amount_won', b.final?.amount_won],
  ];
  for (const [where, bj] of [['deal', b.deal?.blackjack], ['final', b.final?.blackjack]] as const) {
    const sb = bj?.side_bet_results;
    if (!sb) continue;
    for (const [k, x] of Object.entries(sb) as Array<[string, any]>) {
      out.push([`${where}.${k}.amount_placed`, x?.amount_placed], [`${where}.${k}.amount_won`, x?.amount_won]);
    }
  }
  return out;
}

/**
 * The side-bet return DERIVED from the recomputed initial cards: category from the classifier,
 * multiplier from the declared paytable (src/config.ts), times the side stake — exact.
 */
export function derivedSideReturn(b: any, seed: string): { total: Rational; ok: boolean; why?: string } {
  let total: Rational = { num: 0n, den: 1n };
  const sb = b.deal?.blackjack?.side_bet_results;
  if (!sb) return { total, ok: true };
  const p1 = getCard(seed, b.client_seed, b.nonce, 0), up = getCard(seed, b.client_seed, b.nonce, 1), p2 = getCard(seed, b.client_seed, b.nonce, 2);
  for (const [name, x, cat, table, keys] of [
    ['PP', sb.side_perfect_pairs, classifyPerfectPairs(p1, p2), PP_PAYTABLE, PP_KEY],
    ['21+3', sb.side_21_plus_3, classifyTwentyOnePlus3(p1, p2, up), T3_PAYTABLE, T3_KEY],
  ] as const) {
    if (!x) continue;
    const placed = toUnits(x.amount_placed);
    if (placed === null) return { total, ok: false, why: `${name} amount_placed off-grid` };
    if (placed === 0n) continue;
    const mult = cat ? toRational((table as any)[(keys as any)[cat]]) : { num: 0n, den: 1n };
    total = addRational(total, mulUnits(placed, mult!));
  }
  return { total, ok: true };
}

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 7: Settlement from the Cards (exact money) ─────────────────────────
  // THE LABEL IS RECONCILED, NEVER CONSUMED. This step used to switch on `hand.result` — the
  // operator's own label — and compare the sum after parseFloat. It now:
  //   1. takes every card from the RNG at its declared cursor (src/round.ts recomputedHands),
  //   2. settles every hand from those cards under the declared rules (settleRound: natural 2.5,
  //      natural vs natural push, dealer natural 0, bust 0, win 2, push 1, doubled ×2, split hands
  //      each against the dealer, a two-card 21 after a split settled as a total),
  //   3. requires the served label to equal the derived result on every hand,
  //   4. derives both side bets from the recomputed P1, P2 and dealer up-card and the declared
  //      paytable (src/config.ts), and
  //   5. requires amount_won == stake × Σ(main returns) + Σ(side returns) EXACTLY, in 1e-18 grid units.
  // Insurance is never funded in this capture (Step 25: 0 of 462 prompts taken), so it adds 0 and
  // no insurance payout is verified (Step 37 FLAG, MANIFEST.md DL register).
  // Every money string in every record must also lie on the 18-decimal grid (on-grid sweep).
  {
    let reconciled = 0, labelBad = 0, moneyBad = 0, unreadable = 0, skipped = 0;
    let handsDerived = 0, fields = 0, offGrid = 0, insuranceTaken = 0;
    const byResult: Record<string, number> = {};
    const ex: string[] = [];
    for (const b of ctx.bets) {
      for (const [where, v] of moneyFields(b)) {
        if (v === undefined) continue;
        fields++;
        if (toUnits(v) === null) { offGrid++; if (ex.length < 4) ex.push(`bet ${b.id} ${where}=${JSON.stringify(v)} off-grid`); }
      }
      // The insurance term of the sum is 0 only because no insurance was ever taken; a record showing
      // insurance taken would need a term this step does not compute, so it FAILs rather than pass.
      if (b.deal?.blackjack?.insurance_taken !== false || b.final?.blackjack?.insurance_taken !== false) insuranceTaken++;
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      const s = servedRound(b);
      if (!seed || !s) { skipped++; continue; }
      const o = declaredOrder(s);
      if ('error' in o) { unreadable++; continue; }
      const rc = recomputedHands(s, seed, b.client_seed, b.nonce);
      const st = settleRound(rc.hands, rc.dealer, s.hands.length > 1);
      handsDerived += st.length;
      for (const x of st) byResult[x.result] = (byResult[x.result] ?? 0) + 1;
      const labelsOk = st.length === s.hands.length && st.every((x, i) => x.result === s.hands[i].result);
      if (!labelsOk) { labelBad++; if (ex.length < 4) ex.push(`bet ${b.id}: derived ${st.map(x => x.result).join('/')} vs label ${s.hands.map(h => h.result).join('/')}`); }
      const stake = toUnits(b.amount_currency);
      const won = toUnits(b.amount_won);
      const side = derivedSideReturn(b, seed);
      if (stake === null || won === null || !side.ok) { unreadable++; continue; }
      const main: Rational = { num: stake * st.reduce((a, x) => a + x.halfStakes, 0n), den: 2n };
      const expected = addRational(main, side.total);
      if (exactEquals(expected, won)) { if (labelsOk) reconciled++; }
      else { moneyBad++; if (ex.length < 4) ex.push(`bet ${b.id}: derived ${rationalToString(expected)} vs amount_won ${b.amount_won}`); }
    }
    const ok = reconciled === EXPECTED_HANDS && ctx.bets.length === EXPECTED_HANDS && labelBad === 0 && moneyBad === 0
      && unreadable === 0 && skipped === 0 && offGrid === 0 && insuranceTaken === 0;
    results.push(step(7, 'Settlement from the Cards (exact money)',
      ok ? 'PASS' : 'FAIL',
      `${reconciled}/${EXPECTED_HANDS} rounds: every hand settled from the recomputed cards (${handsDerived} hands — ` +
      `${Object.entries(byResult).sort().map(([k, n]) => `${k} ${n}`).join(', ')}), the operator's result label equal to the derivation on every hand ` +
      `(${labelBad} disagree), and amount_won == stake × main returns + side returns derived from the recomputed P1/P2/up-card and the declared paytable, ` +
      `EXACTLY on the 1e-18 grid (${moneyBad} differ). On-grid sweep: ${fields - offGrid}/${fields} money strings on the 18-decimal grid. ` +
      `${unreadable} unreadable, ${skipped} skipped (either FAILS). Insurance: insurance_taken is false at the deal and at settlement on ${EXPECTED_HANDS - insuranceTaken}/${EXPECTED_HANDS} rounds, so the insurance term is 0 (a taken insurance FAILS — no insurance payout is verified, Step 37).` +
      (ex.length ? ` Examples: ${ex.join(' | ')}` : ''),
      { reconciled, expected: EXPECTED_HANDS, handsDerived, byResult, labelBad, moneyBad, fields, offGrid, unreadable, skipped, insuranceTaken }));
  }

  // ── Step 8: Multiplier Provenance (Side Bets) ──────────────────────────────
  // The served multiplier on every placed side bet must equal the declared paytable entry for the
  // category re-derived from the recomputed initial cards — as an exact rational, not at 1e-6.
  {
    let ppChecked = 0, ppMismatch = 0, t3Checked = 0, t3Mismatch = 0, unreadable = 0;
    const ex: string[] = [];
    for (const b of ctx.bets) {
      const sb = b.deal?.blackjack?.side_bet_results;
      if (!sb) continue;
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      if (!seed) { unreadable++; continue; }
      const p1 = getCard(seed, b.client_seed, b.nonce, 0), up = getCard(seed, b.client_seed, b.nonce, 1), p2 = getCard(seed, b.client_seed, b.nonce, 2);
      const check = (x: any, cat: string | null, table: Record<string, string>, keys: Record<string, string>): boolean | null => {
        if (!x || (toUnits(x.amount_placed) ?? 0n) === 0n) return null;
        const want = cat ? toRational(table[keys[cat]])! : { num: 0n, den: 1n };
        const got = toRational(x.multiplier ?? 0);
        return got !== null && want.num * got.den === got.num * want.den;
      };
      const pp = check(sb.side_perfect_pairs, classifyPerfectPairs(p1, p2), PP_PAYTABLE, PP_KEY);
      if (pp !== null) { ppChecked++; if (!pp) { ppMismatch++; if (ex.length < 3) ex.push(`bet ${b.id} PP served ${sb.side_perfect_pairs.multiplier}`); } }
      const t3 = check(sb.side_21_plus_3, classifyTwentyOnePlus3(p1, p2, up), T3_PAYTABLE, T3_KEY);
      if (t3 !== null) { t3Checked++; if (!t3) { t3Mismatch++; if (ex.length < 3) ex.push(`bet ${b.id} 21+3 served ${sb.side_21_plus_3.multiplier}`); } }
    }
    results.push(step(8, 'Multiplier Provenance',
      ppMismatch + t3Mismatch + unreadable === 0 && ppChecked > 0 && t3Checked > 0 ? 'PASS' : 'FAIL',
      `Served side-bet multiplier == declared paytable entry (src/config.ts) for the category re-derived from the recomputed cards, as exact rationals. ` +
      `PP: ${ppChecked} checked, ${ppMismatch} mismatches. 21+3: ${t3Checked} checked, ${t3Mismatch} mismatches. ${unreadable} unreadable.` +
      (ex.length ? ` ${ex.join(' | ')}` : '')));
  }

  // ── Step 9: Bet-Size Invariance ─────────────────────────────────────────────
  // Every Phase E ($10) hand of record recomputes card for card in the declared order (split rounds
  // included — strict, since 2026-09-24) and settles by the same rules from the same cards as a
  // $0.01 hand (Step 7 covers all 6,000; this step re-asserts it on the Phase E population alone).
  {
    let verified = 0, failed = 0, skipped = 0, splits = 0;
    const failExamples: string[] = [];
    for (const b of ctx.phaseE) {
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      const s = servedRound(b);
      if (!seed || !s) { skipped++; continue; }
      const o = declaredOrder(s);
      let ok = !('error' in o) && o.seq.every((card, cursor) => getCard(seed, b.client_seed, b.nonce, cursor) === card);
      if (ok) {
        const rc = recomputedHands(s, seed, b.client_seed, b.nonce);
        const st = settleRound(rc.hands, rc.dealer, s.hands.length > 1);
        ok = st.length === s.hands.length && st.every((x, i) => x.result === s.hands[i].result);
      }
      if (s.hands.length > 1) splits++;
      if (ok) verified++;
      else { failed++; if (failExamples.length < 3) failExamples.push(`Bet ${b.id} nonce=${b.nonce}`); }
    }
    const detail = `${verified}/${EXPECTED_PHASE_HANDS.E} Phase E ($10) hands of record (${ctx.phaseE.length} in dataset, ${splits} split, ${skipped} skipped) recompute card for card in the declared draw order (strict for split rounds) and settle by the same rules from the recomputed cards. Stake is not an HMAC input (\`getCard\` signature contains no wager parameter), so the same procedure that verifies $0.01 hands in Step 5 works identically here; this is a structural property of the RNG, not a per-stake observation.`;
    results.push(step(9, 'Bet-Size Invariance',
      failed === 0 && skipped === 0 && verified === EXPECTED_PHASE_HANDS.E && verified > 0 ? 'PASS' : 'FAIL',
      failed > 0 ? `${detail} Failures: ${failExamples.join(' | ')}` : detail));
  }

  return results;
}

