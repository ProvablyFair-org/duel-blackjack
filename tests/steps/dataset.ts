/**
 * Steps 10–15: Dataset integrity checks
 */

import { computeDatasetHash, EXPECTED_HASH } from '../../src/loader';
import { getCard } from '../../src/rng';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

const EDGE_TOL = 1e-9;

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 10: Captured effective_edge Field Consistency ──────────────────────
  // Field-consistency check on the operator-supplied `effective_edge` (Duel's
  // Zero-Edge rakeback-metadata field). This is NOT the game house edge — the
  // actual optimal-play house edge (0.5704%) is computed independently in the
  // optimal-play engine and reported in simulation-results.json.
  {
    let mainOk = 0, mainBad = 0;
    let ppOk = 0, ppBad = 0;
    let t3Ok = 0, t3Bad = 0;
    const badExamples: string[] = [];

    for (const b of ctx.bets) {
      // Main bet effective_edge — at the bet root
      if (Math.abs(b.effective_edge - 0.1) < EDGE_TOL) mainOk++;
      else { mainBad++; if (badExamples.length < 3) badExamples.push(`Bet ${b.id}: main edge=${b.effective_edge}`); }

      // Side bet effective_edges
      const sb = b.deal?.blackjack?.side_bet_results;
      if (sb) {
        if (sb.side_perfect_pairs && parseFloat(sb.side_perfect_pairs.amount_placed || '0') > 0) {
          if (Math.abs((sb.side_perfect_pairs.effective_edge ?? -1) - 0) < EDGE_TOL) ppOk++;
          else { ppBad++; if (badExamples.length < 3) badExamples.push(`Bet ${b.id}: PP edge=${sb.side_perfect_pairs.effective_edge}`); }
        }
        if (sb.side_21_plus_3 && parseFloat(sb.side_21_plus_3.amount_placed || '0') > 0) {
          if (Math.abs((sb.side_21_plus_3.effective_edge ?? -1) - 0) < EDGE_TOL) t3Ok++;
          else { t3Bad++; if (badExamples.length < 3) badExamples.push(`Bet ${b.id}: 21+3 edge=${sb.side_21_plus_3.effective_edge}`); }
        }
      }
    }

    const totalBad = mainBad + ppBad + t3Bad;
    const detail = `Main edge=0.1: ${mainOk}/${ctx.bets.length}. PP edge=0: ${ppOk}/${ppOk + ppBad}. 21+3 edge=0: ${t3Ok}/${t3Ok + t3Bad}.`;
    results.push(step(10, 'Captured effective_edge Field Consistency',
      totalBad === 0 ? 'PASS' : 'FAIL',
      totalBad > 0 ? `${detail} Bad: ${badExamples.join(' | ')}` : detail
    ));
  }

  // ── Step 11: Config Completeness ────────────────────────────────────────────
  {
    const ppLabels = new Set<string>();
    const t3Labels = new Set<string>();
    for (const b of ctx.bets) {
      const sb = b.deal?.blackjack?.side_bet_results;
      if (!sb) continue;
      if (sb.side_perfect_pairs?.label) ppLabels.add(sb.side_perfect_pairs.label);
      if (sb.side_21_plus_3?.label) t3Labels.add(sb.side_21_plus_3.label);
    }
    const expectedPP = ['Perfect Pair', 'Colored Pair', 'Mixed Pair'];
    const expectedT3 = ['Suited Trips', 'Straight Flush', 'Three of a Kind', 'Straight', 'Flush'];
    const missingPP = expectedPP.filter(l => !ppLabels.has(l));
    const missingT3 = expectedT3.filter(l => !t3Labels.has(l));
    results.push(step(11, 'Config Completeness',
      missingPP.length === 0 && missingT3.length === 0 ? 'PASS' : 'FLAG',
      `PP types observed: ${[...ppLabels].join(', ') || 'none'}. 21+3 types: ${[...t3Labels].join(', ') || 'none'}.${
        missingPP.length || missingT3.length ? ` Missing PP: ${missingPP.join(', ') || '-'}; Missing 21+3: ${missingT3.join(', ') || '-'}` : ''
      }`
    ));
  }

  // ── Step 12: Epoch Size ─────────────────────────────────────────────────────
  // Platform-enforced cap is 50 bets per epoch. PASS criterion is strict
  // 50/50 — any over-cap epoch (>50) is a FLAG; any under-50 is unexpected
  // for the audit's capture pattern (every epoch was filled before rotation).
  const EXPECTED_EPOCH_SIZE = 50;
  {
    let maxEpoch = 0, minEpoch = Infinity;
    let mismatched = 0;
    const offenders: string[] = [];
    for (const [hash, bets] of ctx.byHash) {
      maxEpoch = Math.max(maxEpoch, bets.length);
      minEpoch = Math.min(minEpoch, bets.length);
      if (bets.length !== EXPECTED_EPOCH_SIZE) {
        mismatched++;
        if (offenders.length < 5) offenders.push(`${hash.substring(0,16)}: ${bets.length}`);
      }
    }
    const ok = maxEpoch === EXPECTED_EPOCH_SIZE && minEpoch === EXPECTED_EPOCH_SIZE;
    results.push(step(12, 'Epoch Size',
      ok ? 'PASS' : 'FAIL',
      `${ctx.byHash.size} epochs. Size range: ${minEpoch}–${maxEpoch} bets per epoch. PASS criterion: every epoch contains exactly ${EXPECTED_EPOCH_SIZE} bets (the platform cap). ${mismatched} epochs deviated${offenders.length ? ` (${offenders.join('; ')})` : ''}.`
    ));
  }

  // ── Step 13: Phase Labels ───────────────────────────────────────────────────
  {
    const phases = new Set(ctx.bets.map(b => b.phase));
    const expected = new Set(['A', 'B', 'C', 'D', 'E', 'F']);
    const missing = [...expected].filter(p => !phases.has(p));
    const extra = [...phases].filter(p => !expected.has(p));
    results.push(step(13, 'Phase Labels',
      missing.length === 0 && extra.length === 0 ? 'PASS' : 'FAIL',
      `Phases present: ${[...phases].sort().join(', ')}. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`
    ));
  }

  // ── Step 14: Dataset Hash (compare against pinned value) ────────────────────
  {
    const actual = computeDatasetHash();
    const ok = actual === EXPECTED_HASH;
    results.push(step(14, 'Dataset Hash',
      ok ? 'PASS' : 'FAIL',
      `Actual SHA-256: ${actual}. Expected: ${EXPECTED_HASH}. ${ok ? 'Match.' : 'MISMATCH.'}`
    ));
  }

  // ── Step 15: Phase D Client Seed Variation ──────────────────────────────────
  {
    const dSeeds = new Set(ctx.phaseD.map(b => b.client_seed));
    let recomputeOk = 0, recomputeFail = 0, recomputeSkipped = 0;
    for (const b of ctx.phaseD) {
      const ss = ctx.seedMap.get(b.server_seed_hashed);
      if (!ss) { recomputeSkipped++; continue; }
      const deal = b.deal?.blackjack;
      if (!deal) { recomputeSkipped++; continue; }
      const pc = deal.player.hands[0].cards.filter((c: any) => !c.face_down && c.rank);
      if (pc.length < 1) { recomputeSkipped++; continue; }
      const expected = getCard(ss, b.client_seed, b.nonce, 0);
      const actual = pc[0].rank + pc[0].suit;
      if (expected === actual) recomputeOk++; else recomputeFail++;
    }
    const ok = dSeeds.size >= 10 && recomputeFail === 0;
    results.push(step(15, 'Phase D Client Seed Variation',
      ok ? 'PASS' : 'FAIL',
      `${ctx.phaseD.length} hands; ${dSeeds.size} unique auditor client seeds (${[...dSeeds].slice(0, 3).join(', ')}…). Recompute: ${recomputeOk} ok, ${recomputeFail} failed, ${recomputeSkipped} skipped.`
    ));
  }

  return results;
}
