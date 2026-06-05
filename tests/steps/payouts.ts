/**
 * Steps 7–9: Payout reconciliation, multiplier provenance, bet-size invariance
 */

import { getCard } from '../../src/rng';
import {
  classifyPerfectPairs, classifyTwentyOnePlus3,
  getPPMultiplier, get21Plus3Multiplier,
} from '../../src/sidebets';
import type { BlackjackConfig } from '../../src/types';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

const PP_CONFIG: BlackjackConfig = {
  multipliers: {
    side_perfect_pairs: { bj_perfect_pair: 27, bj_colored_pair: 11, bj_mixed_pair: 7 },
    side_21_plus_3: { bj_suited_trips: 121.2307692, bj_straight_flush: 53, bj_three_kind: 32, bj_straight: 12, bj_flush: 5 },
  },
};

const TOL = 1e-6;

/**
 * Reconcile a bet's amount_won by independently computing the expected total
 * payout from each player hand's result and the side-bet results in the deal
 * response.
 *
 * Per-hand return (× original deal stake):
 *   win                : 2  (2× wager + side bets)
 *   blackjack          : 2.5 (only on the un-split, un-doubled main hand)
 *   push               : 1
 *   bust / lose        : 0
 *   doubled win        : 4
 *   doubled push       : 2
 *   doubled lose/bust  : 0
 *
 * Plus the side-bet wins from deal.side_bet_results.{pp, 21+3}.amount_won.
 */
function expectedAmountWon(bet: any): { expected: number; actual: number; ok: boolean } | null {
  const final = bet.final?.blackjack || bet.final?.blackjackNext?.blackjack;
  const deal = bet.deal?.blackjack;
  if (!final || !deal) return null;

  const stake = parseFloat(bet.deal.amount_currency);
  if (!isFinite(stake) || stake <= 0) return null;

  let expected = 0;
  for (const hand of final.player.hands) {
    const wager = hand.has_doubled ? 2 : 1;
    switch (hand.result) {
      case 'win':       expected += stake * 2 * wager; break;
      case 'blackjack': expected += stake * 2.5; break; // only on unsplit, undoubled
      case 'push':      expected += stake * wager; break;
      case 'lose':
      case 'bust':      break; // 0
      default: return null;     // unknown result → cannot reconcile
    }
  }

  const sb = deal.side_bet_results;
  if (sb) {
    if (sb.side_perfect_pairs) expected += parseFloat(sb.side_perfect_pairs.amount_won || '0');
    if (sb.side_21_plus_3)     expected += parseFloat(sb.side_21_plus_3.amount_won || '0');
  }

  const actual = parseFloat(bet.amount_won);
  return { expected, actual, ok: Math.abs(expected - actual) < TOL };
}

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 7: Payout Math (full reconciliation) ───────────────────────────────
  {
    let reconciled = 0, mismatched = 0, skipped = 0;
    const examples: string[] = [];
    for (const b of ctx.bets) {
      const r = expectedAmountWon(b);
      if (r === null) { skipped++; continue; }
      if (r.ok) reconciled++;
      else {
        mismatched++;
        if (examples.length < 3) {
          examples.push(`Bet ${b.id}: expected ${r.expected.toFixed(6)} got ${r.actual.toFixed(6)}`);
        }
      }
    }
    const detail = `${reconciled}/${ctx.bets.length} bets reconciled (expected = main + side bet wins, ±1e-6). ${mismatched} mismatched, ${skipped} skipped.`;
    results.push(step(7, 'Payout Math',
      mismatched === 0 ? 'PASS' : 'FAIL',
      mismatched > 0 ? `${detail} Examples: ${examples.join(' | ')}` : detail
    ));
  }

  // ── Step 8: Multiplier Provenance (Side Bets) ──────────────────────────────
  {
    let ppChecked = 0, ppMismatch = 0;
    let t3Checked = 0, t3Mismatch = 0;
    for (const b of ctx.bets) {
      const deal = b.deal?.blackjack;
      if (!deal) continue;
      const sb = deal.side_bet_results;
      if (!sb) continue;

      const pp = sb.side_perfect_pairs;
      if (pp && parseFloat(pp.amount_placed || '0') > 0) {
        const playerCards = deal.player.hands[0].cards.filter((c: any) => !c.face_down && c.rank);
        if (playerCards.length >= 2) {
          const c1 = playerCards[0].rank + playerCards[0].suit;
          const c2 = playerCards[1].rank + playerCards[1].suit;
          const expected = getPPMultiplier(classifyPerfectPairs(c1, c2), PP_CONFIG);
          const actual = pp.multiplier || 0;
          ppChecked++;
          if (Math.abs(expected - actual) > 1e-6) ppMismatch++;
        }
      }

      const t3 = sb.side_21_plus_3;
      if (t3 && parseFloat(t3.amount_placed || '0') > 0) {
        const playerCards = deal.player.hands[0].cards.filter((c: any) => !c.face_down && c.rank);
        const dealerUp = deal.dealer.hands[0].cards.filter((c: any) => !c.face_down && c.rank);
        if (playerCards.length >= 2 && dealerUp.length >= 1) {
          const c1 = playerCards[0].rank + playerCards[0].suit;
          const c2 = playerCards[1].rank + playerCards[1].suit;
          const d1 = dealerUp[0].rank + dealerUp[0].suit;
          const expected = get21Plus3Multiplier(classifyTwentyOnePlus3(c1, c2, d1), PP_CONFIG);
          const actual = t3.multiplier || 0;
          t3Checked++;
          if (Math.abs(expected - actual) > 1e-6) t3Mismatch++;
        }
      }
    }
    results.push(step(8, 'Multiplier Provenance',
      ppMismatch + t3Mismatch === 0 ? 'PASS' : 'FAIL',
      `PP: ${ppChecked} checked, ${ppMismatch} mismatches. 21+3: ${t3Checked} checked, ${t3Mismatch} mismatches.`
    ));
  }

  // ── Step 9: Bet-Size Invariance — verify ALL cursors at $10 ────────────────
  // For each Phase E ($10/hand) bet, recompute the entire visible card stream
  // (cursors 0..N-1) from the seed and compare to the captured cards.
  //   Non-split bets: strict cursor-ordered check.
  //   Split bets:     multiset check (covers the 2 split bets in Phase E).
  // Both produce identical card streams to a $0.01 bet using the same seed,
  // confirming card generation is stake-independent.
  {
    let verified = 0, failed = 0;
    const failExamples: string[] = [];
    for (const b of ctx.phaseE) {
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      if (!seed) continue;
      const final = b.final?.blackjack || b.final?.blackjackNext?.blackjack;
      const deal = b.deal?.blackjack;
      if (!deal || !final) continue;

      const isSplit = final.player.hands.length > 1;
      const dealerUp = deal.dealer.hands[0].cards.filter((c: any) => !c.face_down && c.rank)[0];
      const dealerFinal = final.dealer.hands[0].cards.filter((c: any) => !c.face_down && c.rank);
      const playerDeal = deal.player.hands[0].cards.filter((c: any) => !c.face_down && c.rank);
      if (!dealerUp || dealerFinal.length < 2 || playerDeal.length < 2) continue;

      const cardStr = (c: any) => c.rank + c.suit;

      let ok = true;
      if (!isSplit) {
        const playerFinal = final.player.hands[0].cards.filter((c: any) => !c.face_down && c.rank);
        const expected: string[] = [];
        expected.push(cardStr(playerDeal[0]));
        expected.push(cardStr(dealerUp));
        expected.push(cardStr(playerDeal[1]));
        expected.push(cardStr(dealerFinal[1]));
        for (let i = 2; i < playerFinal.length; i++) expected.push(cardStr(playerFinal[i]));
        for (let i = 2; i < dealerFinal.length; i++) expected.push(cardStr(dealerFinal[i]));
        for (let cursor = 0; cursor < expected.length; cursor++) {
          if (getCard(seed, b.client_seed, b.nonce, cursor) !== expected[cursor]) { ok = false; break; }
        }
      } else {
        const ms = new Map<string, number>();
        const bump = (c: string) => ms.set(c, (ms.get(c) || 0) + 1);
        bump(cardStr(playerDeal[0]));
        bump(cardStr(dealerUp));
        bump(cardStr(playerDeal[1]));
        bump(cardStr(dealerFinal[1]));
        for (let h = 0; h < final.player.hands.length; h++) {
          const cards = final.player.hands[h].cards.filter((c: any) => !c.face_down && c.rank);
          for (let i = 1; i < cards.length; i++) bump(cardStr(cards[i]));
        }
        for (let i = 2; i < dealerFinal.length; i++) bump(cardStr(dealerFinal[i]));
        const total = [...ms.values()].reduce((a, b) => a + b, 0);
        const recomputed = new Map<string, number>();
        for (let cursor = 0; cursor < total; cursor++) {
          const c = getCard(seed, b.client_seed, b.nonce, cursor);
          recomputed.set(c, (recomputed.get(c) || 0) + 1);
        }
        if (recomputed.size !== ms.size) ok = false;
        if (ok) for (const [k, v] of ms) if (recomputed.get(k) !== v) { ok = false; break; }
      }

      if (ok) verified++;
      else {
        failed++;
        if (failExamples.length < 3) failExamples.push(`Bet ${b.id} nonce=${b.nonce} (${isSplit ? 'split' : 'non-split'})`);
      }
    }
    const detail = `${verified}/${ctx.phaseE.length} Phase E ($10) hands recompute byte-equal cards from (serverSeed, clientSeed, nonce, cursor) — strict for non-split, multiset for split. Stake is not an HMAC input (\`getCard\` signature contains no wager parameter), so the same procedure that verifies $0.01 hands in Step 5 works identically here; this is a structural property of the RNG, not a per-stake observation.`;
    results.push(step(9, 'Bet-Size Invariance',
      failed === 0 ? 'PASS' : 'FAIL',
      failed > 0 ? `${detail} Failures: ${failExamples.join(' | ')}` : detail
    ));
  }

  return results;
}
