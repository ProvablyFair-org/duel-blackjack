/**
 * Steps 19–27: Blackjack-specific verification
 */

import { handValue, getCard, cardRank } from '../../src/rng';
import { toUnits, toRational, mulUnits, exactEquals, addRational, rationalToString, type Rational } from '../../src/money';
import { servedRound, declaredOrder, recomputedHands, settleRound, finalOf } from '../../src/round';
import { derivedSideReturn } from './payouts';
import { RULES, RULES_IN_EFFECT } from '../../src/config';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

function cardStr(c: any): string { return c.rank + c.suit; }

/**
 * A round settled from its recomputed cards: per-hand derived results and the exact expected
 * amount_won (main from the cards + sides from the recomputed initial cards and the declared
 * paytable). Null when the round cannot be laid out in the declared order or its money is off-grid —
 * the caller counts that as a failure, never a skip.
 */
function derivedRound(ctx: VerifyContext, b: any): { results: string[]; halfStakes: bigint[]; expected: Rational; won: bigint } | null {
  const seed = ctx.seedMap.get(b.server_seed_hashed);
  const s = servedRound(b);
  if (!seed || !s || 'error' in declaredOrder(s)) return null;
  const rc = recomputedHands(s, seed, b.client_seed, b.nonce);
  const st = settleRound(rc.hands, rc.dealer, s.hands.length > 1);
  const stake = toUnits(b.amount_currency), won = toUnits(b.amount_won);
  const side = derivedSideReturn(b, seed);
  if (stake === null || won === null || !side.ok) return null;
  const expected = addRational({ num: stake * st.reduce((a, x) => a + x.halfStakes, 0n), den: 2n }, side.total);
  return { results: st.map(x => x.result), halfStakes: st.map(x => x.halfStakes), expected, won };
}

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 19: Dealer Rule Compliance ─────────────────────────────────────────
  // For each captured hand: if the dealer played out (drew at least one card
  // beyond the hole), every intermediate state and the final state must obey
  // the declared soft-17 rule, read from src/config.ts RULES (Duel: S17 — hit only below 17, stand at
  // any 17+ including soft 17; under H17 a soft 17 must be hit).
  // Hands where the dealer did not need to play out (player BJ, dealer BJ, or
  // every player hand busted) are skipped — there is no rule to verify.
  {
    let dealerPlayedHands = 0, exempt = 0, drewWhenExempt = 0, unread = 0;
    let compliant = 0, violated = 0, soft17Hits = 0, soft17Stands = 0;
    const violationExamples: string[] = [];

    for (const b of ctx.bets) {
      const final = b.final?.blackjack || b.final?.blackjackNext?.blackjack;
      if (!final) { unread++; continue; }

      const dealerCards = final.dealer.hands[0].cards
        .filter((c: any) => !c.face_down && c.rank)
        .map(cardStr);
      if (dealerCards.length < 2) { unread++; continue; }

      // Did the dealer need to play out at all? Decided from the CARDS, not the result labels: the
      // dealer does not draw when either side holds a natural (peek) or every player hand busted.
      const pHands = final.player.hands.map((h: any) => h.cards.filter((c: any) => !c.face_down && c.rank).map(cardStr));
      const playerNat = pHands.length === 1 && pHands[0].length === 2 && handValue(pHands[0]).best === 21;
      const dealerNat = handValue(dealerCards.slice(0, 2)).best === 21;
      const allBust = pHands.every((cs: string[]) => handValue(cs).best > 21);
      const dealerNeededToPlay = !playerNat && !dealerNat && !allBust;

      if (!dealerNeededToPlay) {
        // THE OTHER DIRECTION: an exempt round must show the dealer with exactly the two dealt cards.
        exempt++;
        if (dealerCards.length !== 2) { drewWhenExempt++; if (violationExamples.length < 3) violationExamples.push(`Bet ${b.id}: dealer drew ${dealerCards.length - 2} card(s) in an exempt round`); }
        continue;
      }
      dealerPlayedHands++;

      let valid = true;
      // Step through every position the dealer either drew or stopped at.
      for (let i = 2; i <= dealerCards.length; i++) {
        const handBefore = dealerCards.slice(0, i);
        const hv = handValue(handBefore);

        if (i < dealerCards.length) {
          // Dealer drew the next card — must have been hitting from < 17
          if (hv.best > 17) { valid = false; break; }
          if (hv.best === 17 && !hv.isSoft) { valid = false; break; }
          if (hv.best === 17 && hv.isSoft) soft17Hits++;
        } else {
          // Final state after dealer played out — must be at 17+ (or busted)
          if (hv.best < 17) { valid = false; break; }
          if (hv.best === 17 && hv.isSoft) soft17Stands++;
        }
      }

      if (valid) compliant++;
      else {
        violated++;
        if (violationExamples.length < 3) violationExamples.push(`Bet ${b.id} dealer=${dealerCards.join(',')}`);
      }
    }

    let ruleVerdict = 'undetermined';
    if (soft17Hits > 0 && soft17Stands === 0) ruleVerdict = 'hit (H17)';
    else if (soft17Stands > 0 && soft17Hits === 0) ruleVerdict = 'stand (S17)';
    else if (soft17Hits === 0 && soft17Stands === 0) ruleVerdict = 'no soft-17 cases observed';

    // The declared rule decides which soft-17 outcome FAILs: under S17 a hit, under H17 a stand.
    const declaredS17 = RULES_IN_EFFECT.soft17 === 'stand';
    const ruleName = declaredS17 ? 'S17' : 'H17';
    const wrongSoft17 = declaredS17 ? soft17Hits : soft17Stands;
    const ok19 = violated === 0 && drewWhenExempt === 0 && unread === 0 && dealerPlayedHands + exempt === ctx.bets.length && wrongSoft17 === 0;
    results.push(step(19, 'Dealer Rule Compliance',
      ok19 ? 'PASS' : 'FAIL',
      `${dealerPlayedHands} rounds where the dealer played out: ${compliant} compliant with the declared ${ruleName} (src/config.ts RULES.dealerSoft17 = ${RULES.dealerSoft17}) in both directions (drew only below 17${declaredS17 ? '' : ' or on a soft 17'}, stood at every other 17+), ${violated} violations. ` +
      `${exempt} exempt rounds (a natural on either side — peek — or every player hand busted, decided from the cards): ${exempt - drewWhenExempt} show the dealer with exactly the two dealt cards, ${drewWhenExempt} drew anyway. ` +
      `${dealerPlayedHands + exempt}/${ctx.bets.length} rounds accounted for (${unread} unreadable). Soft-17 outcomes: ${soft17Hits} hits, ${soft17Stands} stands → ${ruleVerdict} (a soft-17 ${declaredS17 ? 'hit' : 'stand'} FAILS: the declared rule is ${ruleName}).${violationExamples.length ? ' ' + violationExamples.join(' | ') : ''}`
    ));
  }

  // ── Step 20: Blackjack Payout (3:2) ─────────────────────────────────────────
  // ISOLATED 3:2 CHECK, from the cards. A natural is DERIVED (an unsplit two-card 21 from the
  // recomputed P1/P2 — never the `blackjack` label), the dealer's two recomputed cards decide natural
  // vs natural (push, gross 1) against natural alone (gross 2.5), and the served amount_won must equal
  // stake × 2.5 (or × 1) + the derived side returns EXACTLY. Every label on those rounds must agree.
  {
    let naturals = 0, pays32 = 0, pushes = 0, wrong = 0;
    const wrongExamples: string[] = [];
    for (const b of ctx.bets) {
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      const s = servedRound(b);
      if (!seed || !s || s.hands.length !== 1) continue;
      const p1 = getCard(seed, b.client_seed, b.nonce, 0), p2 = getCard(seed, b.client_seed, b.nonce, 2);
      if (handValue([p1, p2]).best !== 21) continue;
      naturals++;
      const d = derivedRound(ctx, b);
      const dealerNat = handValue([getCard(seed, b.client_seed, b.nonce, 1), getCard(seed, b.client_seed, b.nonce, 3)]).best === 21;
      const wantHalf = dealerNat ? 2n : RULES_IN_EFFECT.naturalHalfStakes;   // RULES.naturalPays (3:2 → 5 half-stakes)
      const ok = d !== null && d.halfStakes[0] === wantHalf && exactEquals(d.expected, d.won)
        && s.hands[0].result === (dealerNat ? 'push' : 'blackjack');
      if (ok) { if (dealerNat) pushes++; else pays32++; }
      else { wrong++; if (wrongExamples.length < 3) wrongExamples.push(`Bet ${b.id}: derived ${d ? rationalToString(d.expected) : 'unreadable'}, got ${b.amount_won}, label ${s.hands[0].result}`); }
    }
    results.push(step(20, 'Blackjack Payout (3:2)',
      wrong === 0 && pays32 > 0 ? 'PASS' : 'FAIL',
      `${naturals} naturals derived from the recomputed cards (unsplit two-card 21): ${pays32} pay exactly ${RULES_IN_EFFECT.naturalGross} × stake (${RULES.naturalPays}, src/config.ts RULES) + side returns, ${pushes} against a dealer natural push at exactly 1 × stake; ${wrong} wrong. ` +
      `Label agrees with the derivation on every one.${wrongExamples.length ? ' ' + wrongExamples.join(' | ') : ''}`
    ));
  }

  // ── Step 21: Double Payout ──────────────────────────────────────────────────
  // Every hand carrying has_doubled settles at 2× its derived result (win 4, push 2, lose/bust 0 per
  // unit stake), and the round's amount_won equals the derivation exactly.
  {
    let totalDoubledHands = 0, betsWithDouble = 0, reconciled = 0, mismatched = 0;
    const byResult: Record<string, number> = {};
    const wrongExamples: string[] = [];
    for (const b of ctx.bets) {
      const final = finalOf(b);
      if (!final) continue;
      const doubledIdx = final.player.hands.map((h: any, i: number) => h.has_doubled ? i : -1).filter((i: number) => i >= 0);
      if (doubledIdx.length === 0) continue;
      betsWithDouble++;
      totalDoubledHands += doubledIdx.length;
      const d = derivedRound(ctx, b);
      let ok = d !== null && exactEquals(d.expected, d.won);
      if (d) for (const i of doubledIdx) {
        const r = d.results[i], h = d.halfStakes[i];
        byResult[r] = (byResult[r] ?? 0) + 1;
        const want = r === 'win' ? 8n : r === 'push' ? 4n : 0n;
        if (h !== want || final.player.hands[i].result !== r) ok = false;
      }
      if (ok) reconciled++;
      else { mismatched++; if (wrongExamples.length < 3) wrongExamples.push(`Bet ${b.id}: derived ${d ? rationalToString(d.expected) : 'unreadable'}, got ${b.amount_won}`); }
    }
    results.push(step(21, 'Double Payout',
      mismatched === 0 && reconciled === betsWithDouble && betsWithDouble > 0 ? 'PASS' : 'FAIL',
      `${reconciled}/${betsWithDouble} rounds with at least one doubled hand reconcile exactly (${totalDoubledHands} doubled hands, derived from the cards: ` +
      `${Object.entries(byResult).sort().map(([k, n]) => `${k} ${n}`).join(', ')}). win = 4× / push = 2× / lose or bust = 0 per doubled hand.${wrongExamples.length ? ' ' + wrongExamples.join(' | ') : ''}`
    ));
  }

  // ── Step 22: Split Draw Order ───────────────────────────────────────────────
  // STRICT, NOT A MULTISET. Every split round must recompute card for card in the Duel declared split
  // order P1 D1 P2 D2 · H1 second · H2 second · H1 plays out · H2 plays out · dealer (src/round.ts
  // declaredOrder): cursor 4 is hand 1's second card, cursor 5 hand 2's, then hand 1's draws, then
  // hand 2's, then the dealer's. Until 2026-09-24 the step compared the multiset of cursors 0..N−1,
  // which a reordering of post-split draws passed. Each split hand must also start with the dealt
  // card it was split from (hand 1 = P1, hand 2 = P2).
  {
    const splitBets = ctx.bets.filter(b => b.actions.includes('split'));
    let ok = 0, failed = 0, skipped = 0, cursors = 0;
    const failExamples: string[] = [];
    for (const b of splitBets) {
      const ss = ctx.seedMap.get(b.server_seed_hashed);
      const s = servedRound(b);
      if (!ss || !s) { skipped++; continue; }
      const o = declaredOrder(s);
      if ('error' in o || s.hands.length !== 2) { failed++; if (failExamples.length < 3) failExamples.push(`Bet ${b.id}: ${'error' in o ? o.error : `${s.hands.length} hands`}`); continue; }
      const bad = o.seq.findIndex((card, c) => getCard(ss, b.client_seed, b.nonce, c) !== card);
      if (bad < 0) { ok++; cursors += o.seq.length; }
      else { failed++; if (failExamples.length < 3) failExamples.push(`Bet ${b.id}: cursor ${bad} served ${o.seq[bad]}`); }
    }
    results.push(step(22, 'Split Draw Order (declared, strict)',
      failed === 0 && skipped === 0 && ok === splitBets.length && ok > 0 ? 'PASS' : 'FAIL',
      `${ok}/${splitBets.length} split rounds recompute card for card in the declared split order P1 D1 P2 D2 · H1 second · H2 second · H1 plays · H2 plays · dealer (${cursors} cursors). ` +
      `${failed} failed, ${skipped} skipped (a skipped split round FAILS the step).${failExamples.length ? ' ' + failExamples.join(' | ') : ''}`
    ));
  }

  // ── Step 23: Split Rules Verification — observed rules match Duel.com ───────
  // Confirms: only matching-rank pairs split, DAS allowed, no re-splits, split
  // aces receive exactly one card each (no further actions). All asserted from
  // the actual captured data.
  {
    const splitBets = ctx.bets.filter(b => b.actions.includes('split'));
    let dasObserved = 0;
    let reSplits = 0;
    let badPair = 0;            // splits offered on non-matching ranks (would be a violation)
    let aceSplitOk = 0, aceSplitBad = 0;

    for (const b of splitBets) {
      const deal = b.deal?.blackjack;
      const final = b.final?.blackjack || b.final?.blackjackNext?.blackjack;
      if (!deal || !final) continue;

      // Confirm starting cards have matching rank (Duel rule)
      const startCards = deal.player.hands[0].cards.filter((c: any) => !c.face_down && c.rank);
      if (startCards.length === 2) {
        if (cardRank(startCards[0].rank + startCards[0].suit) !== cardRank(startCards[1].rank + startCards[1].suit)) badPair++;
      }

      const splitCount = b.actions.filter((a: string) => a === 'split').length;
      if (splitCount >= 2) reSplits++;
      if (b.actions.includes('double')) dasObserved++;

      // Split aces: each sub-hand should have exactly 2 cards (one card after split, no further action)
      if (startCards.length === 2 && startCards[0].rank === 'A' && startCards[1].rank === 'A') {
        const allTwoCards = final.player.hands.every((h: any) => h.cards.filter((c: any) => !c.face_down).length === 2);
        if (allTwoCards) aceSplitOk++; else aceSplitBad++;
      }
    }

    const verdict = badPair === 0 && reSplits === 0 && aceSplitBad === 0 ? 'PASS' : 'FAIL';
    results.push(step(23, 'Split Rules Verification',
      verdict,
      `${splitBets.length} splits. Matching-rank-only: ${splitBets.length - badPair}/${splitBets.length} (${badPair} violations). DAS observed: ${dasObserved}. Re-splits: ${reSplits}. Ace splits one-card-only: ${aceSplitOk}/${aceSplitOk + aceSplitBad} (${aceSplitBad} violations).`
    ));
  }

  // ── Step 24: Split Payout Independence ──────────────────────────────────────
  // Every split round: each hand settled on its own against the dealer from the recomputed cards,
  // the label of each hand equal to its derivation, the returns summed per hand, and amount_won equal
  // to that sum + derived side returns EXACTLY. A two-card 21 on a split hand is NOT a natural — it
  // must settle as a total (1:1 on a win); the step counts those witnesses.
  {
    const splitBets = ctx.bets.filter(b => b.actions.includes('split'));
    let checked = 0, reconciled = 0, mismatched = 0, twoCard21 = 0, twoCard21Paid1to1 = 0;
    const fails: string[] = [];
    for (const b of splitBets) {
      const s = servedRound(b);
      if (!s || s.hands.length < 2) { mismatched++; continue; }
      checked++;
      const d = derivedRound(ctx, b);
      const labels = d !== null && d.results.every((r, i) => s.hands[i].result === r);
      for (let i = 0; i < s.hands.length; i++) {
        if (s.hands[i].cards.length === 2 && handValue(s.hands[i].cards).best === 21) {
          twoCard21++;
          if (d && (d.results[i] === 'win' ? d.halfStakes[i] === (s.hands[i].doubled ? 8n : 4n) : d.results[i] === 'push')) twoCard21Paid1to1++;
        }
      }
      if (d && labels && exactEquals(d.expected, d.won)) reconciled++;
      else { mismatched++; if (fails.length < 3) fails.push(`Bet ${b.id}: derived ${d ? rationalToString(d.expected) : 'unreadable'}, got ${b.amount_won}`); }
    }
    results.push(step(24, 'Split Payout Independence',
      mismatched === 0 && reconciled === splitBets.length && reconciled > 0 && twoCard21Paid1to1 === twoCard21 ? 'PASS' : 'FAIL',
      `${reconciled}/${splitBets.length} split rounds reconcile exactly to the sum of per-hand settlements derived from the cards (each hand vs dealer independently, labels agree). ` +
      `Two-card 21 on a split hand settles as a total, not a natural: ${twoCard21Paid1to1}/${twoCard21} witnessed. ${mismatched} mismatched.${fails.length ? ' ' + fails.join(' | ') : ''}`
    ));
  }

  // ── Step 25: Insurance Prompt Condition (offer logic only — payouts not exercised) ──────────────────
  // The "cross-check" loop that used to sit here had an empty body and its counter was void'ed —
  // dead code that printed nothing and could fail nothing. It is now a real check, in both
  // directions, over every captured deal: the prompt (an insurance / no_insurance action) and the
  // deal's own `insurance_available` flag must each be present exactly when the upcard is an Ace.
  // An Ace deal with no prompt (offer withheld) and a non-Ace deal with one both FAIL, as does a
  // deal that cannot be read.
  {
    let withDealerAce = 0, withoutDealerAce = 0, aceWithoutPrompt = 0;
    let flagAgree = 0, flagDisagree = 0, unreadable = 0, aceDeals = 0;
    const examples: string[] = [];
    for (const b of ctx.bets) {
      const deal = b.deal?.blackjack;
      const dealerUp = deal?.dealer?.hands?.[0]?.cards?.find((c: any) => !c.face_down && c.rank);
      if (!deal || !dealerUp) { unreadable++; continue; }
      const isAce = dealerUp.rank === 'A';
      const prompted = b.actions.includes('no_insurance') || b.actions.includes('insurance');
      if (isAce) aceDeals++;
      if (prompted && isAce) withDealerAce++;
      else if (prompted && !isAce) { withoutDealerAce++; if (examples.length < 3) examples.push(`bet ${b.id}: prompt on ${dealerUp.rank} upcard`); }
      else if (!prompted && isAce) { aceWithoutPrompt++; if (examples.length < 3) examples.push(`bet ${b.id}: Ace upcard, no prompt`); }
      if ((deal.insurance_available === true) === isAce) flagAgree++;
      else { flagDisagree++; if (examples.length < 3) examples.push(`bet ${b.id}: insurance_available=${deal.insurance_available} on ${dealerUp.rank} upcard`); }
    }
    const ok = withoutDealerAce === 0 && aceWithoutPrompt === 0 && flagDisagree === 0 && unreadable === 0
      && flagAgree === ctx.bets.length && withDealerAce > 0;

    results.push(step(25, 'Insurance Prompt Condition',
      ok ? 'PASS' : 'FAIL',
      `${withDealerAce + withoutDealerAce} insurance prompts, all declined by the capture script (no payout side exercised — see MANIFEST.md#limitations-and-trust R-INSURANCE). ` +
      `${withDealerAce}/${aceDeals} Ace-upcard deals prompted (${aceWithoutPrompt} withheld), ${withoutDealerAce} prompts on a non-Ace upcard (must be 0). ` +
      `deal.insurance_available agrees with the upcard on ${flagAgree}/${ctx.bets.length} deals (${flagDisagree} disagree, ${unreadable} unreadable).` +
      (examples.length ? ` ${examples.join(' | ')}` : '')
    ));
  }

  // ── Step 26: Side Bet Payouts Match Multiplier × Stake ──────────────────────
  // Every placed side bet: served amount_won == served multiplier × amount_placed EXACTLY (the
  // multiplier as the exact rational of its decimal, amounts in 1e-18 grid units). Step 8 ties the
  // served multiplier to the declared paytable; Step 7 ties the whole round to the cards.
  {
    let ppOk = 0, ppBad = 0, t3Ok = 0, t3Bad = 0;
    const fails: string[] = [];
    for (const b of ctx.bets) {
      const sb = b.deal?.blackjack?.side_bet_results;
      if (!sb) continue;
      for (const [name, x] of [['PP', sb.side_perfect_pairs], ['21+3', sb.side_21_plus_3]] as const) {
        if (!x) continue;
        const placed = toUnits(x.amount_placed);
        if (placed === 0n) continue;
        const won = toUnits(x.amount_won), mult = toRational(x.multiplier ?? 0);
        const ok = placed !== null && won !== null && mult !== null && exactEquals(mulUnits(placed, mult), won);
        if (name === 'PP') { if (ok) ppOk++; else { ppBad++; if (fails.length < 3) fails.push(`Bet ${b.id} PP: mult=${x.multiplier} placed=${x.amount_placed} got=${x.amount_won}`); } }
        else { if (ok) t3Ok++; else { t3Bad++; if (fails.length < 3) fails.push(`Bet ${b.id} 21+3: mult=${x.multiplier} placed=${x.amount_placed} got=${x.amount_won}`); } }
      }
    }
    results.push(step(26, 'Perfect Pairs + 21+3 Payout',
      ppBad + t3Bad === 0 && ppOk > 0 && t3Ok > 0 ? 'PASS' : 'FAIL',
      `PP: ${ppOk} reconciled, ${ppBad} mismatched. 21+3: ${t3Ok} reconciled, ${t3Bad} mismatched. amount_won == multiplier × amount_placed EXACTLY (exact rationals on the 1e-18 grid).${fails.length ? ' ' + fails.join(' | ') : ''}`
    ));
  }

  // ── Step 27: Side Bet Independence — deal vs final consistency ──────────────
  // The side-bet result is computed from cursors 0/2/1 (P1, P2, dealer upcard)
  // at deal time and must not change between the deal and final responses,
  // regardless of how the main hand plays out.
  {
    let ppConsistent = 0, ppChanged = 0, t3Consistent = 0, t3Changed = 0;
    const fails: string[] = [];
    for (const b of ctx.bets) {
      const dealSB = b.deal?.blackjack?.side_bet_results;
      const finalBJ = b.final?.blackjack || b.final?.blackjackNext?.blackjack;
      const finalSB = finalBJ?.side_bet_results;
      if (!dealSB || !finalSB) continue;

      const dPP = dealSB.side_perfect_pairs, fPP = finalSB.side_perfect_pairs;
      if (dPP && fPP) {
        const sameMult = (dPP.multiplier || 0) === (fPP.multiplier || 0);
        const sameLabel = (dPP.label || null) === (fPP.label || null);
        const sameWon = toUnits(String(dPP.amount_won ?? '0')) === toUnits(String(fPP.amount_won ?? '0')) && toUnits(String(dPP.amount_won ?? '0')) !== null;
        if (sameMult && sameLabel && sameWon) ppConsistent++;
        else { ppChanged++; if (fails.length < 3) fails.push(`Bet ${b.id} PP changed`); }
      }

      const dT3 = dealSB.side_21_plus_3, fT3 = finalSB.side_21_plus_3;
      if (dT3 && fT3) {
        const sameMult = (dT3.multiplier || 0) === (fT3.multiplier || 0);
        const sameLabel = (dT3.label || null) === (fT3.label || null);
        const sameWon = toUnits(String(dT3.amount_won ?? '0')) === toUnits(String(fT3.amount_won ?? '0')) && toUnits(String(dT3.amount_won ?? '0')) !== null;
        if (sameMult && sameLabel && sameWon) t3Consistent++;
        else { t3Changed++; if (fails.length < 3) fails.push(`Bet ${b.id} 21+3 changed`); }
      }
    }

    // NO FORFEIT ON SPLIT (profile BLACKJACK-14: "a forfeit-on-split rule is stated where it exists").
    // Duel settles both side bets at the deal, before any action. Measured, not assumed: every split
    // round whose side bet won at the deal still carries that win at settlement, and Step 7 includes
    // it in the exact amount_won reconciliation — so no side bet is forfeited by splitting.
    let splitSideWins = 0, splitSideKept = 0;
    for (const b of ctx.bets) {
      if (!b.actions.includes('split')) continue;
      const d = b.deal?.blackjack?.side_bet_results, f = (b.final?.blackjack || b.final?.blackjackNext?.blackjack)?.side_bet_results;
      for (const k of ['side_perfect_pairs', 'side_21_plus_3']) {
        const dw = toUnits(String(d?.[k]?.amount_won ?? '0'));
        if (dw === null || dw === 0n) continue;
        splitSideWins++;
        if (toUnits(String(f?.[k]?.amount_won ?? '0')) === dw) splitSideKept++;
      }
    }
    results.push(step(27, 'Side Bet Independence',
      ppChanged + t3Changed === 0 && splitSideKept === splitSideWins ? 'PASS' : 'FAIL',
      `PP: ${ppConsistent} unchanged across deal→final, ${ppChanged} changed. 21+3: ${t3Consistent} unchanged, ${t3Changed} changed. This step proves the side-bet result is deal-time invariant — it does not mutate as the main hand plays out. The companion claim that the side-bet inputs are exactly cursors 0, 2, 1 (P1, P2, dealer upcard) is established by Step 8's independent reclassification from those three cards. No forfeit on split: ${splitSideKept}/${splitSideWins} winning side bets on split rounds are still paid at settlement (and reconciled exactly by Step 7).${fails.length ? ' ' + fails.join(' | ') : ''}`
    ));
  }

  return results;
}
