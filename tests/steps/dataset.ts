/**
 * Steps 10–15: Dataset integrity checks
 */

import { computeDatasetHash, EXPECTED_HASH, EXPECTED_HANDS, EXPECTED_SEEDS, EXPECTED_EPOCH_SIZE, EXPECTED_PHASE_HANDS, EXPECTED_PHASE_D_CLIENT_SEEDS, PHASE_D_SEED_PREFIX } from '../../src/loader';
import { getCard } from '../../src/rng';
import { PP_PAYTABLE, T3_PAYTABLE, PP_LABELS, T3_LABELS, RULES, RULES_IN_EFFECT, rulesInEffect } from '../../src/config';
import * as fs from 'fs';
import * as path from 'path';
import { toRational } from '../../src/money';
import { servedRound, declaredOrder } from '../../src/round';
import { computeOptimalRTP, computeAverageWager } from '../../src/optimal-play';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

const EDGE_TOL = 1e-9;

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 10: Captured effective_edge Field Consistency ──────────────────────
  // Field-consistency check on the operator-supplied `effective_edge` (a per-bet
  // field Duel serves; its statements do not name it). This is NOT the game house edge — the
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
    // RECONCILIATION, STATED (profile BLACKJACK-19). The served label is not applied to the hand, and
    // it reads the same 0.1% as the net edge after rakeback in Duel's description, not the game's edge
    // (MANIFEST.md, Duel's edge model; DL-7 closed). A Duel staff member has stated a 0.57% edge; the
    // modelled optimal-play edge is reported per initial bet and per total amount wagered (Step 16).
    // The step still FAILs on any record whose label differs from the constant.
    const eng = computeOptimalRTP();
    const aw = computeAverageWager();
    const edgeInitialPct = eng.edge * 100;
    const edgeTotalPct = (eng.edge / aw.averageWager) * 100;
    const detail = `Main edge=0.1: ${mainOk}/${ctx.bets.length}. PP edge=0: ${ppOk}/${ppOk + ppBad}. 21+3 edge=0: ${t3Ok}/${t3Ok + t3Bad}. ` +
      `Reconciliation: the served label is not applied to the hand, and it reads the same 0.1% as the net edge after rakeback in Duel's description, not the game's edge (MANIFEST.md, Duel's edge model; DL-7 closed). ` +
      `A Duel staff member has stated a 0.57% edge; the modelled optimal-play edge is ${edgeInitialPct.toFixed(4)}% per initial bet and ${edgeTotalPct.toFixed(4)}% per total amount wagered (average wager ${aw.averageWager.toFixed(6)}, Step 16). ` +
      `Side-bet labels 0 agree with the exact enumeration of the declared paytable, the one the captured $0.01 side bets were paid at (Step 16: Perfect Pairs edge exactly 0, 21+3 edge 16/1406080000000; no other side-bet stake was captured).`;
    results.push(step(10, 'Captured effective_edge Field Consistency',
      totalBad === 0 ? 'PASS' : 'FAIL',
      totalBad > 0 ? `${detail} Bad: ${badExamples.join(' | ')}` : detail
    ));
  }

  // ── Step 11: Config Completeness ────────────────────────────────────────────
  // Two different questions, now scored differently. (1) A served side-bet label that is NOT in
  // the published table — a payout category the rules do not declare — is a FAIL. (2) A published
  // category that simply never occurred in the capture is a sampling outcome (Suited Trips is
  // 1/2704 per hand under an infinite deck), not a defect, and stays a FLAG. The old step had only
  // the FLAG branch, so an undeclared category was never looked for at all.
  {
    const ppLabels = new Set<string>();
    const t3Labels = new Set<string>();
    for (const b of ctx.bets) {
      const sb = b.deal?.blackjack?.side_bet_results;
      if (!sb) continue;
      if (sb.side_perfect_pairs?.label) ppLabels.add(sb.side_perfect_pairs.label);
      if (sb.side_21_plus_3?.label) t3Labels.add(sb.side_21_plus_3.label);
    }
    const expectedPP = Object.values(PP_LABELS);
    const expectedT3 = Object.values(T3_LABELS);
    const missingPP = expectedPP.filter(l => !ppLabels.has(l));
    const missingT3 = expectedT3.filter(l => !t3Labels.has(l));
    const undeclaredPP = [...ppLabels].filter(l => !expectedPP.includes(l));
    const undeclaredT3 = [...t3Labels].filter(l => !expectedT3.includes(l));
    const undeclared = undeclaredPP.length + undeclaredT3.length;
    const missing = missingPP.length + missingT3.length;
    results.push(step(11, 'Config Completeness',
      undeclared > 0 ? 'FAIL' : missing > 0 ? 'FLAG' : 'PASS',
      `PP types observed: ${[...ppLabels].join(', ') || 'none'} (${expectedPP.length} published). 21+3 types: ${[...t3Labels].join(', ') || 'none'} (${expectedT3.length} published). ` +
      `Undeclared (not in the published table, FAIL): ${[...undeclaredPP, ...undeclaredT3].join(', ') || 'none'}. ` +
      `Published but not observed (FLAG): ${[...missingPP, ...missingT3].join(', ') || 'none'}.`
    ));
  }

  // ── Step 12: Epoch Size ─────────────────────────────────────────────────────
  // The capture's epoch size is 50 bets: the capture script rotated after 50 hands itself
  // (BETS_PER_EPOCH in capture/capture.reference.js). The data shows no platform limit of 50 hands
  // per seed: the seven capture-retry gap epochs each served nonce 50, the 51st nonce on that seed.
  // PASS criterion is strict 50/50 — any epoch of a different size, over (>50) or under (<50), is a
  // FAIL: the capture plan filled every epoch before rotating.
  // EXPECTED_EPOCH_SIZE now comes from src/loader.ts — see the POPULATION OF RECORD block there.
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
      `${ctx.byHash.size} epochs. Size range: ${minEpoch}–${maxEpoch} bets per epoch. PASS criterion: every epoch contains exactly ${EXPECTED_EPOCH_SIZE} bets (the capture's epoch size). ${mismatched} epochs deviated${offenders.length ? ` (${offenders.join('; ')})` : ''}.`
    ));
  }

  // ── Step 13: Population of Record & Phase Labels ────────────────────────────
  {
    // A LABEL IS NOT A COUNT. This step asserted only that {A…F} were all present and nothing
    // extra was — true of a dataset with a third of its hands deleted, since every phase still has
    // SOME rows. The counts and the total now come from src/loader.ts, which is the only place a
    // forger cannot fix by editing the dataset and re-pinning its hash.
    const phases = new Set(ctx.bets.map(b => b.phase));
    const expected = new Set(Object.keys(EXPECTED_PHASE_HANDS));
    const missing = [...expected].filter(p => !phases.has(p));
    const extra = [...phases].filter(p => !expected.has(p));

    const counts: Record<string, number> = {};
    for (const b of ctx.bets) counts[b.phase] = (counts[b.phase] ?? 0) + 1;
    const phaseBad = Object.entries(EXPECTED_PHASE_HANDS)
      .filter(([p, n]) => (counts[p] ?? 0) !== n)
      .map(([p, n]) => `${p}: ${counts[p] ?? 0} != ${n}`);
    const handsOk = ctx.bets.length === EXPECTED_HANDS;
    const seedsOk = ctx.seeds.length === EXPECTED_SEEDS;

    results.push(step(13, 'Population of Record & Phase Labels',
      missing.length === 0 && extra.length === 0 && phaseBad.length === 0 && handsOk && seedsOk ? 'PASS' : 'FAIL',
      `${ctx.bets.length}/${EXPECTED_HANDS} hands and ${ctx.seeds.length}/${EXPECTED_SEEDS} seed records against the capture plan in src/loader.ts (code constants, not the dataset header); ` +
      `per phase ${Object.entries(EXPECTED_PHASE_HANDS).map(([p, n]) => `${p}=${counts[p] ?? 0}/${n}`).join(' ')}. ` +
      `Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.` +
      (handsOk ? '' : ' HAND COUNT MISMATCH.') +
      (seedsOk ? '' : ' SEED COUNT MISMATCH.') +
      (phaseBad.length ? ` PHASE MISMATCH ${phaseBad.join(', ')}.` : '')
    ));
  }

  // ── Step 14: Dataset Hash (compare against pinned value) ────────────────────
  // Also scores the dataset's own `config.multipliers` block — written by capture/capture.js from
  // constants at save time, not a recorded response — against the single-sourced declared paytable in src/config.ts, key for key and
  // as exact rationals (profile BLACKJACK-26). A missing, extra or different entry FAILs.
  {
    const actual = computeDatasetHash();
    const ok = actual === EXPECTED_HASH;
    const cfg = ctx.datasetConfig?.multipliers ?? {};
    const cfgProblems: string[] = [];
    let cfgChecked = 0;
    for (const [block, table] of [['side_perfect_pairs', PP_PAYTABLE], ['side_21_plus_3', T3_PAYTABLE]] as const) {
      const served = cfg[block] ?? {};
      const keys = new Set([...Object.keys(served), ...Object.keys(table)]);
      for (const k of keys) {
        const want = toRational((table as any)[k]);
        const got = toRational(served[k]);
        cfgChecked++;
        if (!want || !got || want.num * got.den !== got.num * want.den) cfgProblems.push(`${block}.${k}: dataset ${JSON.stringify(served[k])} vs declared ${JSON.stringify((table as any)[k])}`);
      }
    }
    // THE RULE SET IS SINGLE-SOURCED (profile BLACKJACK-26). src/round.ts (replay + settlement),
    // src/optimal-play.ts (engine) and src/simulate.ts (simulator) read RULES_IN_EFFECT, derived from
    // src/config.ts RULES alone. Scored here: the derivation is current, the engine reports the rules
    // it solved, and the pinned simulation artifact records the rules the simulator ran under — each
    // must equal RULES, so an edited RULES that the committed evidence was not produced under FAILs.
    const rulesProblems: string[] = [];
    let derived: unknown = null;
    try { derived = rulesInEffect(RULES); } catch (e: any) { rulesProblems.push(String(e?.message ?? e)); }
    if (derived && JSON.stringify(derived, (_k, v) => typeof v === 'bigint' ? String(v) : v)
      !== JSON.stringify(RULES_IN_EFFECT, (_k, v) => typeof v === 'bigint' ? String(v) : v)) rulesProblems.push('RULES_IN_EFFECT is not the derivation of RULES');
    const engRules = computeOptimalRTP();
    if (engRules.s17 !== RULES.dealerSoft17 || engRules.das !== RULES.das) rulesProblems.push(`engine solved s17=${engRules.s17} das=${engRules.das}`);
    let simRules: any = null;
    try { simRules = JSON.parse(fs.readFileSync(path.join(ctx.outputsDir, 'simulation-results.json'), 'utf-8')).rules; } catch { /* absent: reported below */ }
    const wantSim = { soft17: RULES.dealerSoft17, doubleAfterSplit: RULES.das, surrender: RULES.surrender, reSplit: RULES.maxSplits > 1, deck: RULES.deck };
    if (!simRules) rulesProblems.push('simulation artifact carries no rules block');
    else for (const [k, v] of Object.entries(wantSim)) if (simRules[k] !== v) rulesProblems.push(`simulation ran under ${k}=${JSON.stringify(simRules[k])}, RULES says ${JSON.stringify(v)}`);
    results.push(step(14, 'Dataset Hash & Config Block',
      ok && cfgProblems.length === 0 && rulesProblems.length === 0 && cfgChecked === Object.keys(PP_PAYTABLE).length + Object.keys(T3_PAYTABLE).length ? 'PASS' : 'FAIL',
      `Actual SHA-256: ${actual}. Expected: ${EXPECTED_HASH}. ${ok ? 'Match.' : 'MISMATCH.'} ` +
      `Dataset config.multipliers vs the declared paytable (src/config.ts, the one table every step imports): ${cfgChecked - cfgProblems.length}/${cfgChecked} entries equal as exact rationals. ` +
      `Rule set single-sourced: the replay, settlement, engine and simulator read src/config.ts RULES (S17 ${RULES.dealerSoft17}, DAS ${RULES.das}, split aces one card ${RULES.splitAcesOneCard}, natural ${RULES.naturalPays}); engine solved s17=${engRules.s17} das=${engRules.das}; pinned simulation ran under ${simRules ? JSON.stringify(simRules) : 'NO rules block'} — ${rulesProblems.length ? 'DISAGREE' : 'all equal RULES'}.` +
      (cfgProblems.length || rulesProblems.length ? ` Problems: ${[...cfgProblems, ...rulesProblems].join('; ')}` : '')
    ));
  }

  // ── Step 15: Phase D Client Seed Variation ──────────────────────────────────
  // Every Phase D hand is recomputed IN FULL (every visible card, declared draw order — it used to
  // be cursor 0 only) under the client seed actually used. The Phase D seeds are the capture script's
  // FIXED strings PHASE_D_SEED_PREFIX + 00…09 — predictable by construction — so the step enumerates
  // the exposed epochs (server-seed commitment → client seed) in its detail and the MANIFEST.md DL
  // register discloses them (profile BLACKJACK-06).
  {
    const dSeeds = new Set(ctx.phaseD.map(b => b.client_seed));
    let recomputeOk = 0, recomputeFail = 0, recomputeSkipped = 0, cursors = 0;
    for (const b of ctx.phaseD) {
      const ss = ctx.seedMap.get(b.server_seed_hashed);
      const sr = servedRound(b);
      if (!ss || !sr) { recomputeSkipped++; continue; }
      const o = declaredOrder(sr);
      if ('error' in o) { recomputeFail++; continue; }
      if (o.seq.every((card, c) => getCard(ss, b.client_seed, b.nonce, c) === card)) { recomputeOk++; cursors += o.seq.length; }
      else recomputeFail++;
    }
    const epochsPerSeed = new Map<string, Set<string>>();
    for (const b of ctx.phaseD) {
      if (!epochsPerSeed.has(b.client_seed)) epochsPerSeed.set(b.client_seed, new Set());
      epochsPerSeed.get(b.client_seed)!.add(b.server_seed_hashed);
    }
    const reusedAcrossEpochs = [...epochsPerSeed.values()].filter(s => s.size !== 1).length;
    const usedOutsideD = ctx.bets.filter(b => b.phase !== 'D' && dSeeds.has(b.client_seed)).length;
    const predictable = [...dSeeds].filter(cs => new RegExp(`^${PHASE_D_SEED_PREFIX}\\d{2}$`).test(cs)).length;
    const exposed = [...epochsPerSeed.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([cs, hs]) => `${cs}→${[...hs][0].substring(0, 16)}`);
    const ok = dSeeds.size === EXPECTED_PHASE_D_CLIENT_SEEDS && reusedAcrossEpochs === 0 && usedOutsideD === 0
      && recomputeFail === 0 && recomputeSkipped === 0 && recomputeOk === EXPECTED_PHASE_HANDS.D;
    results.push(step(15, 'Phase D Client Seed Variation',
      ok ? 'PASS' : 'FAIL',
      `${ctx.phaseD.length}/${EXPECTED_PHASE_HANDS.D} hands; ${dSeeds.size}/${EXPECTED_PHASE_D_CLIENT_SEEDS} unique auditor client seeds, ` +
      `${reusedAcrossEpochs} spanning more than one epoch, ${usedOutsideD} non-Phase-D hands reusing one. Full recompute (every card, declared order): ` +
      `${recomputeOk} ok (${cursors} cursors), ${recomputeFail} failed, ${recomputeSkipped} skipped. ` +
      `PREDICTABLE SEEDS, DISCLOSED: ${predictable}/${dSeeds.size} Phase D client seeds are the fixed strings ${PHASE_D_SEED_PREFIX}00…09; exposed epochs (client seed → commitment): ${exposed.join(', ')}.`
    ));
  }

  return results;
}
