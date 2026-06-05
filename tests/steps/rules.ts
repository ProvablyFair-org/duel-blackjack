/**
 * Steps 28–33: Game-Rule Coverage Checks
 *
 * Each step verifies a stated rule from `game-rules.md` against the captured
 * 6,000-hand dataset. These were added to close gaps Mike flagged: every
 * claimed rule should have a scored step producing an evidence count for the
 * rule-check table in the report.
 *
 * No new bets needed — every check derives from existing dataset fields.
 */

import type { VerifyContext, StepResult } from './context';
import { step } from './context';

const ALLOWED_ACTIONS = new Set([
  'hit', 'stand', 'double', 'split', 'insurance', 'no_insurance',
]);

// Per-phase expected main stake (Phases A,B,C,D,F = $0.01; Phase E = $10/hand)
const PHASE_EXPECTED_STAKE: Record<string, string> = {
  A: '0.01',
  B: '0.01',
  C: '0.01',
  D: '0.01',
  E: '10',
  F: '0.01',
};

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 28: Available Actions Set ─────────────────────────────────────────
  // Confirms every `available_actions` list at the deal and at each action
  // response is a subset of {hit, stand, double, split, insurance,
  // no_insurance}. Counts `surrender` appearances (rules: never offered).
  // Catches a casino that quietly adds an action or surrenders implicitly.
  {
    let totalLists = 0, compliantLists = 0, surrenderHits = 0;
    const unknownActions = new Set<string>();
    const exampleViolations: string[] = [];

    for (const b of ctx.bets) {
      const lists: string[][] = [];
      const dealActions = b.deal?.blackjack?.available_actions;
      if (Array.isArray(dealActions)) lists.push(dealActions);
      const actionResps = (b as any).actionResponses;
      if (Array.isArray(actionResps)) {
        for (const r of actionResps) {
          const next = r?.blackjack?.available_actions ?? r?.blackjackNext?.blackjack?.available_actions;
          if (Array.isArray(next)) lists.push(next);
        }
      }
      for (const lst of lists) {
        totalLists++;
        let ok = true;
        for (const a of lst) {
          if (a === 'surrender') { surrenderHits++; ok = false; }
          else if (!ALLOWED_ACTIONS.has(a)) { unknownActions.add(a); ok = false; }
        }
        if (ok) compliantLists++;
        else if (exampleViolations.length < 3) {
          exampleViolations.push(`bet ${b.id}: [${lst.join(', ')}]`);
        }
      }
    }

    const verdict = (totalLists - compliantLists === 0 && surrenderHits === 0 && unknownActions.size === 0)
      ? 'PASS' : 'FAIL';
    results.push(step(28, 'Available Actions Set',
      verdict,
      `${compliantLists}/${totalLists} action lists are subsets of {hit, stand, double, split, insurance, no_insurance}. ` +
      `surrender appearances: ${surrenderHits} (rules state 0). ` +
      (unknownActions.size ? `Unknown actions seen: [${[...unknownActions].join(', ')}]. ` : '') +
      (exampleViolations.length ? `Examples: ${exampleViolations.join(' | ')}` : '')
    ));
  }

  // ── Step 29: Infinite-Deck Confirmation ────────────────────────────────────
  // Counts hands where ≥2 visible cards share the exact same rank+suit. Such
  // a hand is impossible under any finite-deck model, so even one observation
  // refutes the alternative. Reports the full count as the empirical evidence
  // for the infinite-deck claim.
  {
    let handsWithDuplicate = 0, totalHands = 0;
    const examples: string[] = [];

    for (const b of ctx.bets) {
      totalHands++;
      const seen = new Map<string, number>();
      const collect = (h: any) => {
        if (!h?.cards) return;
        for (const c of h.cards) {
          if (c.face_down || !c.rank) continue;
          const key = c.rank + c.suit;
          seen.set(key, (seen.get(key) || 0) + 1);
        }
      };
      const final = b.final?.blackjack || b.final?.blackjackNext?.blackjack;
      const source = final || b.deal?.blackjack;
      if (source) {
        for (const h of source.player.hands || []) collect(h);
        for (const h of source.dealer.hands || []) collect(h);
      }
      let dupCard: string | null = null;
      for (const [k, n] of seen) if (n >= 2) { dupCard = k; break; }
      if (dupCard) {
        handsWithDuplicate++;
        if (examples.length < 3) examples.push(`bet ${b.id}: ${dupCard} appeared ≥2×`);
      }
    }

    // PASS if at least 1 hand shows a duplicate (refutes finite-deck).
    // 0 across 6,000 hands would be statistically unusual; report as FLAG.
    results.push(step(29, 'Infinite-Deck Confirmation',
      handsWithDuplicate > 0 ? 'PASS' : 'FLAG',
      `${handsWithDuplicate} / ${totalHands} hands contain ≥2 visible cards with identical rank+suit ` +
      `(only possible under infinite-deck draw with replacement). ` +
      (examples.length ? `Examples: ${examples.join(' | ')}.` : '')
    ));
  }

  // ── Step 30: Outcome Distribution ──────────────────────────────────────────
  // Counts every player hand's `result` field and verifies the bucket set is
  // a subset of {win, lose, push, bust, blackjack}; surrender must be 0.
  // Provides empirical counts for the win/push/loss/bust rules in one step.
  {
    const counts = new Map<string, number>();
    const unknown = new Set<string>();
    let totalHands = 0, hasResult = 0;

    for (const b of ctx.bets) {
      const final = b.final?.blackjack || b.final?.blackjackNext?.blackjack;
      if (!final?.player?.hands) continue;
      for (const h of final.player.hands) {
        totalHands++;
        const r = h.result;
        if (r == null) continue;
        hasResult++;
        counts.set(r, (counts.get(r) || 0) + 1);
        if (!['win', 'lose', 'push', 'bust', 'blackjack', 'surrender'].includes(r)) {
          unknown.add(r);
        }
      }
    }

    const surrenderCount = counts.get('surrender') || 0;
    const buckets = [...counts.entries()].sort().map(([k, v]) => `${k}=${v}`).join(', ');
    const verdict = (surrenderCount === 0 && unknown.size === 0) ? 'PASS' : 'FAIL';

    results.push(step(30, 'Outcome Distribution',
      verdict,
      `${hasResult}/${totalHands} player hands have a result field. Buckets: ${buckets}. ` +
      `surrender=${surrenderCount} (rules state 0). ` +
      (unknown.size ? `Unknown: [${[...unknown].join(', ')}]` : '')
    ));
  }

  // ── Step 31: Side Bet Stake Equality ───────────────────────────────────────
  // When PP and/or 21+3 are placed alongside the main bet, their stake must
  // equal the main stake. Catches a hidden multiplier or fee on side wagers.
  {
    let mainCheckedPP = 0, mainEqualsPP = 0;
    let mainCheckedT3 = 0, mainEqualsT3 = 0;
    const failExamples: string[] = [];

    for (const b of ctx.bets) {
      const main = parseFloat(b.amount_currency);
      const sb = b.deal?.blackjack?.side_bet_results;
      if (!sb) continue;

      const pp = sb.side_perfect_pairs;
      const t3 = sb.side_21_plus_3;

      if (pp && parseFloat(pp.amount_placed || '0') > 0) {
        mainCheckedPP++;
        if (Math.abs(parseFloat(pp.amount_placed) - main) < 1e-9) mainEqualsPP++;
        else if (failExamples.length < 3) failExamples.push(`bet ${b.id} PP=${pp.amount_placed} main=${b.amount_currency}`);
      }
      if (t3 && parseFloat(t3.amount_placed || '0') > 0) {
        mainCheckedT3++;
        if (Math.abs(parseFloat(t3.amount_placed) - main) < 1e-9) mainEqualsT3++;
        else if (failExamples.length < 3) failExamples.push(`bet ${b.id} 21+3=${t3.amount_placed} main=${b.amount_currency}`);
      }
    }

    const ppFails = mainCheckedPP - mainEqualsPP;
    const t3Fails = mainCheckedT3 - mainEqualsT3;

    results.push(step(31, 'Side Bet Stake Equality',
      (ppFails === 0 && t3Fails === 0) ? 'PASS' : 'FAIL',
      `PP stake = main stake: ${mainEqualsPP}/${mainCheckedPP}. 21+3 stake = main stake: ${mainEqualsT3}/${mainCheckedT3}. ` +
      (failExamples.length ? `Mismatches: ${failExamples.join(' | ')}` : '')
    ));
  }

  // ── Step 32: Initial Deal Structure ────────────────────────────────────────
  // Every captured deal must show: 2 visible player cards, 2 dealer cards.
  // The dealer hole card is face-down EXCEPT when the hand resolves at deal
  // (player BJ or dealer BJ — both reveal the hole to settle immediately).
  // This is the standard BJ rule and matches the dataset's auto-resolve flow.
  // Catches malformed deals or a different game variant (e.g. a 1-card-dealer
  // deal).
  {
    let totalDeals = 0, compliant = 0, autoResolved = 0;
    let failedTwoP = 0, failedTwoD = 0, failedOneHole = 0;
    const fails: string[] = [];

    for (const b of ctx.bets) {
      totalDeals++;
      const deal = b.deal?.blackjack;
      const final = b.final?.blackjack || b.final?.blackjackNext?.blackjack;
      const pCards = deal?.player?.hands?.[0]?.cards || [];
      const dCards = deal?.dealer?.hands?.[0]?.cards || [];
      const pOk = pCards.length === 2 && pCards.every((c: any) => !c.face_down && c.rank);
      const dOk = dCards.length === 2;
      const dHole = dCards.filter((c: any) => c.face_down).length;

      if (!pOk) failedTwoP++;
      if (!dOk) failedTwoD++;

      // Hand auto-resolved at deal? (player or dealer BJ) → hole legitimately
      // revealed. Detect from CARDS, not flags — when both sides have natural
      // BJ the API records result='push' and both has_blackjack flags stay
      // null even though the deal did auto-resolve.
      const isNaturalBJ = (cards: any[]): boolean => {
        if (!cards || cards.length !== 2) return false;
        const ranks = cards.filter((c: any) => !c.face_down && c.rank).map((c: any) => c.rank);
        if (ranks.length !== 2) return false;
        const tenLike = (r: string) => r === '10' || r === 'J' || r === 'Q' || r === 'K';
        return (ranks[0] === 'A' && tenLike(ranks[1])) || (ranks[1] === 'A' && tenLike(ranks[0]));
      };
      const playerBJ = isNaturalBJ(pCards);
      const dealerBJ = isNaturalBJ(dCards.map((c: any) => ({ ...c, face_down: false })));  // ignore face_down for the rank check
      const expectHidden = !(playerBJ || dealerBJ);

      if (expectHidden) {
        if (dCards.length === 2 && dHole !== 1) failedOneHole++;
        if (pOk && dOk && dHole === 1) compliant++;
        else if (fails.length < 3) fails.push(`bet ${b.id}: P=${pCards.length} D=${dCards.length} holes=${dHole} (no auto-resolve)`);
      } else {
        // Auto-resolved hands: dealer hole legitimately revealed at deal.
        // Still confirm 2P + 2D shape.
        autoResolved++;
        if (pOk && dOk) compliant++;
        else if (fails.length < 3) fails.push(`bet ${b.id} (auto-resolve): P=${pCards.length} D=${dCards.length}`);
      }
    }

    results.push(step(32, 'Initial Deal Structure',
      compliant === totalDeals ? 'PASS' : 'FAIL',
      `${compliant}/${totalDeals} deals show valid initial structure (2 player cards + 2 dealer cards; ` +
      `dealer hole face-down except for ${autoResolved} auto-resolved BJ hands where it is legitimately revealed). ` +
      `Failures: 2-player-cards ${failedTwoP}, 2-dealer-cards ${failedTwoD}, 1-hole-when-required ${failedOneHole}. ` +
      (fails.length ? `Examples: ${fails.join(' | ')}` : '')
    ));
  }

  // ── Step 33: Stake Bracket Bounds ──────────────────────────────────────────
  // Every bet's main stake must equal the expected stake for its phase
  // (A,B,C,D,F = $0.01; E = $10). Catches stake-mix errors in capture or
  // any unexpected stake entering the dataset.
  {
    let total = 0, compliant = 0;
    const phaseFails = new Map<string, number>();
    const fails: string[] = [];

    for (const b of ctx.bets) {
      total++;
      const expected = PHASE_EXPECTED_STAKE[b.phase];
      if (expected == null) continue;
      const exp = parseFloat(expected);
      const got = parseFloat(b.amount_currency);
      if (Math.abs(exp - got) < 1e-9) compliant++;
      else {
        phaseFails.set(b.phase, (phaseFails.get(b.phase) || 0) + 1);
        if (fails.length < 3) fails.push(`bet ${b.id} phase=${b.phase} expected=$${expected} got=$${b.amount_currency}`);
      }
    }

    const off = total - compliant;
    results.push(step(33, 'Stake Bracket Bounds',
      off === 0 ? 'PASS' : 'FAIL',
      `${compliant}/${total} bets at the expected stake for their phase (A/B/C/D/F=$0.01, E=$10). ` +
      (off
        ? `Off-stake by phase: ${[...phaseFails.entries()].map(([p, n]) => `${p}=${n}`).join(', ')}. Examples: ${fails.join(' | ')}`
        : '')
    ));
  }

  return results;
}
