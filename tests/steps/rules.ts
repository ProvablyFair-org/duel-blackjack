/**
 * Steps 28–33: Game-Rule Coverage Checks
 *
 * Each step verifies a stated rule from `MANIFEST.md#game-and-algorithm` against the captured
 * 6,000-hand dataset. These were added to close gaps Mike flagged: every
 * claimed rule should have a scored step producing an evidence count for the
 * rule-check table in the report.
 *
 * No new bets needed — every check derives from existing dataset fields.
 */

import { toUnits } from '../../src/money';
import { PHASE_STAKE } from '../../src/config';
import { getCard, cardRank, handValue } from '../../src/rng';
import { chi2PValue } from '../../src/stats';
import { EXPECTED_HANDS } from '../../src/loader';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

const ALLOWED_ACTIONS = new Set([
  'hit', 'stand', 'double', 'split', 'insurance', 'no_insurance',
]);

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

    // SCORED AGAINST THE MODEL, NOT "AT LEAST ONE". The old verdict was PASS on >= 1 duplicate and
    // FLAG otherwise — no FAIL existed, though zero duplicates in 6,000 hands is decisive evidence of
    // a finite shoe. The whole-hand count above depends on how many cards the strategy drew, so it
    // has no strategy-free expectation. The first four cursors do: P1, dealer upcard, P2 and dealer
    // hole are drawn before any decision, so under draw-with-replacement from 52 they contain a
    // repeated rank+suit with probability p4 = 1 − (52·51·50·49)/52⁴ exactly. The count over the
    // population is Binomial(n, p4); a count outside n·p4 ± 5σ FAILS (too few = finite-shoe
    // behaviour, too many = not uniform). Every hand must yield its four initial cards.
    const P4 = 1 - (52 * 51 * 50 * 49) / (52 ** 4);
    let initialDup = 0, initialRead = 0;
    for (const b of ctx.bets) {
      const deal = b.deal?.blackjack;
      const final = b.final?.blackjack || b.final?.blackjackNext?.blackjack;
      const vis = (cs: any[] | undefined) => (cs || []).filter((c: any) => !c.face_down && c.rank).map((c: any) => c.rank + c.suit);
      const p = vis(deal?.player?.hands?.[0]?.cards);
      const up = vis(deal?.dealer?.hands?.[0]?.cards)[0];
      const dFinal = vis(final?.dealer?.hands?.[0]?.cards);
      if (p.length < 2 || !up || dFinal.length < 2) continue;
      initialRead++;
      const four = [p[0], up, p[1], dFinal[1]];
      if (new Set(four).size < 4) initialDup++;
    }
    const n4 = ctx.bets.length;
    const mean4 = n4 * P4;
    const sd4 = Math.sqrt(n4 * P4 * (1 - P4));
    const z4 = sd4 > 0 ? (initialDup - mean4) / sd4 : Infinity;
    const ok29 = initialRead === n4 && n4 > 0 && Math.abs(z4) <= 5;
    results.push(step(29, 'Infinite-Deck Confirmation',
      ok29 ? 'PASS' : 'FAIL',
      `Initial four cursors (P1, dealer up, P2, dealer hole): ${initialDup}/${initialRead} hands repeat a rank+suit ` +
      `(read ${initialRead}/${n4}); infinite-deck expectation ${mean4.toFixed(1)} ± ${sd4.toFixed(1)} (p4 = ${P4.toFixed(6)}), z = ${z4.toFixed(2)}, ` +
      `PASS band |z| ≤ 5. A single finite deck gives 0. Whole hand: ${handsWithDuplicate} / ${totalHands} hands contain ≥2 visible cards with identical rank+suit ` +
      `(only possible under infinite-deck draw with replacement). ` +
      (examples.length ? `Examples: ${examples.join(' | ')}.` : '')
    ));
  }

  // ── Step 30: Outcome Distribution & Live-Sample Fit ────────────────────────
  // Bucket census of every hand's result (surrender and unknown results FAIL), plus the live-sample
  // FIT profile BLACKJACK-22 asks for, all from the RECOMPUTED cards:
  //   - first card (cursor 0, P1) rank against the uniform 13-rank distribution (χ², 12 df);
  //   - player naturals (P1+P2) and dealer naturals (up+hole) against 8/169 each (binomial z);
  //   - the money-path return Σ amount_won / Σ staked, LABELLED a reconciliation of this capture's
  //     play, not an RTP (the RTP is Step 16's engine).
  // FIT_ALPHA / FIT_Z are the deviation thresholds; a fit outside them is reported as INFO (profile
  // policy INFORMATIONAL, Mike 2026-09-29: never a FLAG, never counted, verdict unchanged), never a
  // PASS. The census half (surrender / unknown results) still FAILs. Live-sample power is low at 6,000
  // hands — the authoritative uniformity test is Step 17.
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
        if (!['win', 'lose', 'push', 'bust', 'blackjack', 'surrender'].includes(r)) unknown.add(r);
      }
    }
    const surrenderCount = counts.get('surrender') || 0;
    const buckets = [...counts.entries()].sort().map(([k, v]) => `${k}=${v}`).join(', ');

    const FIT_ALPHA = 0.001, FIT_Z = 4;
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const first = new Map<string, number>(RANKS.map(r => [r, 0]));
    let pNat = 0, dNat = 0, n = 0, staked = 0n, returned = 0n;
    for (const b of ctx.bets) {
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      if (!seed) continue;
      n++;
      const c = [0, 1, 2, 3].map(k => getCard(seed, b.client_seed, b.nonce, k));
      first.set(cardRank(c[0]), (first.get(cardRank(c[0])) ?? 0) + 1);
      if (handValue([c[0], c[2]]).best === 21) pNat++;
      if (handValue([c[1], c[3]]).best === 21) dNat++;
      staked += toUnits(b.amount_currency) ?? 0n;
      const sb = b.deal?.blackjack?.side_bet_results;
      if (sb) for (const x of [sb.side_perfect_pairs, sb.side_21_plus_3]) if (x) staked += toUnits(x.amount_placed) ?? 0n;
      returned += toUnits(b.amount_won) ?? 0n;
    }
    const e = n / 13;
    const chi2 = [...first.values()].reduce((a, o) => a + (o - e) ** 2 / e, 0);
    const chiP = chi2PValue(chi2, 12);
    const pn = 8 / 169, sd = Math.sqrt(n * pn * (1 - pn));
    const zP = (pNat - n * pn) / sd, zD = (dNat - n * pn) / sd;
    const moneyPath = Number((returned * 1_000_000n) / (staked || 1n)) / 10_000;
    const fitOk = chiP >= FIT_ALPHA && Math.abs(zP) <= FIT_Z && Math.abs(zD) <= FIT_Z && n === EXPECTED_HANDS;
    const censusOk = surrenderCount === 0 && unknown.size === 0;
    results.push(step(30, 'Outcome Distribution & Live-Sample Fit',
      !censusOk ? 'FAIL' : fitOk ? 'PASS' : 'INFO',
      `${hasResult}/${totalHands} player hands have a result field. Buckets: ${buckets}. surrender=${surrenderCount} (rules state 0). ` +
      (unknown.size ? `Unknown: [${[...unknown].join(', ')}]. ` : '') +
      `Live-sample fit on ${n}/${EXPECTED_HANDS} recomputed deals: first-card rank χ² = ${chi2.toFixed(3)} (12 df), p = ${chiP.toFixed(4)} (deviation reported below ${FIT_ALPHA}); ` +
      `player naturals ${pNat} (expected ${(n * pn).toFixed(1)} = 8/169, z = ${zP.toFixed(2)}); dealer naturals ${dNat} (z = ${zD.toFixed(2)}); deviation reported beyond |z| ${FIT_Z}. ` +
      `The fit is informational: a deviation is INFO, never counted, verdict unchanged. ` +
      `Money-path reconciliation (NOT an RTP — this capture's strategy and side-bet mix): returned/staked = ${moneyPath.toFixed(4)}% over ${n} rounds.`,
      { chi2, chiP, playerNaturals: pNat, dealerNaturals: dNat, zPlayerNatural: zP, zDealerNatural: zD, moneyPathPct: moneyPath }));
  }

  // ── Step 31: Side Bet Stake Equality ───────────────────────────────────────
  // When PP and/or 21+3 are placed alongside the main bet, their stake must
  // equal the main stake. Catches a hidden multiplier or fee on side wagers.
  {
    let mainCheckedPP = 0, mainEqualsPP = 0;
    let mainCheckedT3 = 0, mainEqualsT3 = 0;
    const failExamples: string[] = [];

    for (const b of ctx.bets) {
      const main = toUnits(b.amount_currency);
      const sb = b.deal?.blackjack?.side_bet_results;
      if (!sb) continue;

      const pp = sb.side_perfect_pairs;
      const t3 = sb.side_21_plus_3;

      if (pp && (toUnits(pp.amount_placed) ?? 1n) !== 0n) {
        mainCheckedPP++;
        if (main !== null && toUnits(pp.amount_placed) === main) mainEqualsPP++;
        else if (failExamples.length < 3) failExamples.push(`bet ${b.id} PP=${pp.amount_placed} main=${b.amount_currency}`);
      }
      if (t3 && (toUnits(t3.amount_placed) ?? 1n) !== 0n) {
        mainCheckedT3++;
        if (main !== null && toUnits(t3.amount_placed) === main) mainEqualsT3++;
        else if (failExamples.length < 3) failExamples.push(`bet ${b.id} 21+3=${t3.amount_placed} main=${b.amount_currency}`);
      }
    }

    const ppFails = mainCheckedPP - mainEqualsPP;
    const t3Fails = mainCheckedT3 - mainEqualsT3;

    results.push(step(31, 'Side Bet Stake Equality',
      (ppFails === 0 && t3Fails === 0) ? 'PASS' : 'FAIL',
      `PP stake = main stake: ${mainEqualsPP}/${mainCheckedPP}. 21+3 stake = main stake: ${mainEqualsT3}/${mainCheckedT3} (exact, 1e-18 grid). ` +
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

    // PRE-SETTLEMENT HIDDEN-STATE SWEEP (profile BLACKJACK-17). Every response the capture holds from
    // BEFORE the round settled — the deal and every action response whose status is not the settled
    // status 5 — is swept for anything that would expose hidden state: a face-down card must carry an
    // EMPTY rank and suit (not a value hidden only by a flag), the dealer hand's served `value` must be
    // the value of its visible cards alone (a value counting the hole card would leak it), and the
    // round's server seed plaintext must appear nowhere in the response. Any leak FAILs.
    let preResponses = 0, holeLeaks = 0, valueLeaks = 0, seedLeaks = 0, faceDownCards = 0;
    for (const b of ctx.bets) {
      const pre: any[] = [];
      if (b.deal?.status !== 5) pre.push(b.deal);
      for (const r of (b as any).actionResponses || []) {
        const x = r?.blackjackNext ?? r;
        if (x && x.status !== 5) pre.push(x);
      }
      for (const resp of pre) {
        preResponses++;
        const bj = resp?.blackjack;
        const dh = bj?.dealer?.hands?.[0];
        for (const c of dh?.cards || []) {
          if (!c.face_down) continue;
          faceDownCards++;
          if (c.rank !== '' || c.suit !== '') { holeLeaks++; if (fails.length < 3) fails.push(`bet ${b.id}: face-down card carries rank/suit`); }
        }
        const visible = (dh?.cards || []).filter((c: any) => !c.face_down && c.rank).map((c: any) => c.rank + c.suit);
        if (dh && visible.length > 0 && dh.value !== handValue(visible).best) { valueLeaks++; if (fails.length < 3) fails.push(`bet ${b.id}: dealer value ${dh.value} != visible ${handValue(visible).best}`); }
        if (b.server_seed && JSON.stringify(resp).includes(b.server_seed)) { seedLeaks++; if (fails.length < 3) fails.push(`bet ${b.id}: server seed plaintext in a pre-settlement response`); }
      }
    }
    const sweepOk = holeLeaks === 0 && valueLeaks === 0 && seedLeaks === 0 && preResponses >= ctx.bets.length - autoResolved;

    results.push(step(32, 'Initial Deal Structure & Hidden-State Sweep',
      compliant === totalDeals && sweepOk ? 'PASS' : 'FAIL',
      `${compliant}/${totalDeals} deals show valid initial structure (2 player cards + 2 dealer cards; ` +
      `dealer hole face-down except for ${autoResolved} auto-resolved BJ hands where it is legitimately revealed). ` +
      `Failures: 2-player-cards ${failedTwoP}, 2-dealer-cards ${failedTwoD}, 1-hole-when-required ${failedOneHole}. ` +
      `Pre-settlement sweep over ${preResponses} captured responses (deal + action responses before status 5): ${faceDownCards} face-down cards, ${holeLeaks} carrying a rank or suit; ` +
      `${valueLeaks} dealer values counting a hidden card; ${seedLeaks} containing the round's server seed plaintext. ` +
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
      const expected = PHASE_STAKE[b.phase];
      if (expected == null) { if (fails.length < 3) fails.push(`bet ${b.id} phase=${b.phase} has no declared stake`); phaseFails.set(b.phase, (phaseFails.get(b.phase) || 0) + 1); continue; }
      const got = toUnits(b.amount_currency);
      if (got !== null && got === toUnits(expected)) compliant++;
      else {
        phaseFails.set(b.phase, (phaseFails.get(b.phase) || 0) + 1);
        if (fails.length < 3) fails.push(`bet ${b.id} phase=${b.phase} expected=$${expected} got=$${b.amount_currency}`);
      }
    }

    const off = total - compliant;
    results.push(step(33, 'Stake Bracket Bounds',
      off === 0 ? 'PASS' : 'FAIL',
      `${compliant}/${total} bets at exactly the declared stake for their phase (src/config.ts PHASE_STAKE: A/B/C/D/F=$0.01, E=$10; exact on the 1e-18 grid). ` +
      (off
        ? `Off-stake by phase: ${[...phaseFails.entries()].map(([p, n]) => `${p}=${n}`).join(', ')}. Examples: ${fails.join(' | ')}`
        : '')
    ));
  }

  return results;
}
