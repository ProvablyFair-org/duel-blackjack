/**
 * Monte Carlo simulation for Duel.com Blackjack audit.
 *
 * Pass 1 — Multi-stream Fisher's method (10 streams × 1M hands = 10M total).
 *   Single-config game (infinite deck, one rule set) → Fisher's method.
 *   Each stream uses one of 10 PINNED seed pairs (SIM_SEEDS, generated once
 *   via crypto.randomBytes and hardcoded for reproducibility). Same seeds
 *   every run → bit-identical simRTP, Fisher's p, and convergence chart on
 *   any reviewer's machine. No casino data is used as input.
 *   RTP is reported per ORIGINAL wager (RTP = 1 + E[net_profit] / initial_wager,
 *   where initial_wager = $1 per round). This matches the optimal-play engine
 *   and Wizard of Odds convention; doubles and splits add to total wager but
 *   the RTP denominator stays at the initial wager so the simulator and the
 *   analytical engine compare the same metric.
 *   Per-stream test: z-test of streamRTP against the analytical optimal-play
 *   RTP from src/optimal-play.ts (independent reference). Fisher-combined:
 *   T = -2 Σ ln(p_i) ~ χ²(2K).
 *   Serial independence: per-stream lag-1 + runs test, Bonferroni-corrected
 *   per-stream alpha (α = 0.01 / streams).
 *
 * Pass 2 — Captured casino seeds × 10,000 nonces (cherry-pick detection).
 *   Early-nonce window vs extended nonces per seed.
 *
 * Output: simulation-results.json + rtp-convergence.html.
 *
 * OUTPUT DIRECTORY. The committed copies in outputs/ are pinned artifacts of record
 * (src/artifact-pins.ts, scored by verify Step 34). A run must not silently overwrite them:
 * PF_EMIT=1 (`npm run simulate`) rewrites the pinned artifacts — the author, on a deliberate
 * regeneration that re-pins them in the same commit; otherwise (`npm run simulate:run`, which
 * `npm run test:full` calls) the run lands in outputs/run/ and verify field-diffs it against the
 * committed copy at the reproduction tolerance.
 */

import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';

import { getCardWithKey } from './rng';
import { simulateHand, SOFT17_RULE, DAS_ALLOWED } from './sim-hand';
import { loadDataset, buildSeedMap } from './loader';
import { computeOptimalRTP } from './optimal-play';
import { chi2PValue, normalCDF, inverseNormalCDF, binomialP } from './stats';
import { renderConvergenceHtml } from './chart';
import { windowSums, testC, TEST_C_WINDOW, TEST_C_WINDOWS, TEST_C_ALPHA, TEST_C_FLAG_RANK, TEST_C_NULL_P, flagBound } from './cherry-pick';
import { RETIRED_FIGURE_FORMERLY_CALLED_WOO } from './config';
import { PASS1_STREAMS, PASS1_ROUNDS_EACH, PASS1_ROUNDS_TOTAL, PASS2_NONCES, EARLY_WINDOW, SERIAL_ALPHA_FAMILY, CHERRY_ALPHA } from './sim-plan';

// ── Configuration ─────────────────────────────────────────────────────────────

// PASS1_STREAMS, PASS1_ROUNDS_EACH, PASS1_ROUNDS_TOTAL, PASS2_NONCES, EARLY_WINDOW: src/sim-plan.ts
// SOFT17_RULE and DAS_ALLOWED: src/sim-hand.ts, read from src/config.ts RULES.

const CONVERGENCE_POINTS = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];
export const FIRST_CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// PF_EMIT=1 rewrites the pinned artifacts; otherwise the run lands in outputs/run/ so test:full can
// diff it against the committed copy without touching the evidence it scores.
const PF_EMIT  = process.env.PF_EMIT === '1';
const OUT_BASE = path.join(__dirname, '..', 'outputs');
const OUT_DIR  = PF_EMIT ? OUT_BASE : path.join(OUT_BASE, 'run');
const OUT_LABEL = PF_EMIT ? 'outputs' : 'outputs/run';

// Pass 1 simulation seeds — one unique pair per stream.
// Generated once via crypto.randomBytes(32/16), pinned for reproducibility:
// every reviewer's `npm run simulate` produces bit-identical numbers. No
// casino data is used as input — these are independent random bytes.
const SIM_SEEDS: Array<{ server: string; client: string }> = [
  { server: '2420f708b5b67ad9c5df5fc62e5b5fed4601a1e33d4d145c12b5996090d8dd58', client: 'c772e3090033e1a282fece2e3fe4873a' },
  { server: '30983ea650a9338e858743f92189ed8fae282eae955a2f6ea406aa5ba1d6ecf5', client: 'fa8301973e46928cf81ad78205250a0c' },
  { server: '951327dd6d9d0ca8731ee47c19875fa1d41b81d4c7a7ca4b547dc4bc2d1936dd', client: '34ff531b7d0f75e39507d82cbdbe2903' },
  { server: '64131adab008fed78588ea44735eea9d465627bfafaf176f5131d13e1537c39c', client: 'd243fe17af243d072be0ecc75564ea23' },
  { server: 'cab5ffb02206efa5f0c54a105a246d5872a8f60c50db34cd3ecf2d40d8df7ca9', client: 'a2e66644f1a44c09ee5c45315809554f' },
  { server: 'ca7d27c44e210d1e6f8a4de12f0e6f028c7de1d0dbd6c6bef8ee8f2e8d1b0e9f', client: 'b6707ad416f5a777efd8d8fcc3aa7a4d' },
  { server: '376300eba5d5dd87d01aa1091b6d3aadd3f02be3c39c4e998cf209cd83817d02', client: '74830cdc39dd6e9c3b22bb80faaf9ef2' },
  { server: 'e8e37e633274b61d117cb396b8f415bb6d73d5a2c673faa834eee66c0249cd50', client: 'bc8b39eca0eab469618ef07f7ae28d9b' },
  { server: '525a66185b126ac2c2deeefffa5baefebae67088e134180d615893f32cd6c081', client: '4303edac3c9f7951a04796a5a0fcfb1c' },
  { server: '9a583738527dc4f18b9f5011df894bf694083c3a14a92888409108d912145234', client: 'c8ef289764219bdbe75cc997a2db8c32' },
];

// ── Stats Functions ──────────────────────────────────────────────────────────

function lag1Auto(values: number[]): { r: number; z: number } {
  const n = values.length;
  let mean = 0; for (const v of values) mean += v; mean /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n - 1; i++) { num += (values[i] - mean) * (values[i+1] - mean); }
  for (let i = 0; i < n; i++) { den += (values[i] - mean) ** 2; }
  const r = den === 0 ? 0 : num / den;
  return { r, z: r * Math.sqrt(n) };
}

function runsTest(values: number[]): { z: number; pValue: number } {
  const median = [...values].sort((a,b) => a - b)[Math.floor(values.length / 2)];
  const binary = values.map(v => v >= median ? 1 : 0);
  const n = binary.length;
  const n1 = binary.filter(b => b === 1).length;
  const n0 = n - n1;
  if (n1 === 0 || n0 === 0) return { z: 0, pValue: 1 };
  let runs = 1;
  for (let i = 1; i < n; i++) { if (binary[i] !== binary[i-1]) runs++; }
  const expRuns = 1 + (2 * n1 * n0) / n;
  const varRuns = (2 * n1 * n0 * (2 * n1 * n0 - n)) / (n * n * (n - 1));
  const z = varRuns > 0 ? (runs - expRuns) / Math.sqrt(varRuns) : 0;
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  return { z, pValue: p };
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function progressBar(current: number, total: number, label: string, startTime: number): void {
  const pct = current / total;
  const filled = Math.round(pct * 30);
  const bar = '━'.repeat(filled) + '╌'.repeat(30 - filled);
  const elapsed = (Date.now() - startTime) / 1000;
  const eta = elapsed / pct - elapsed;
  process.stdout.write(`\r  ${label} [${bar}] ${(pct*100).toFixed(1)}% | ${elapsed.toFixed(0)}s / ETA ${eta.toFixed(0)}s`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('  DUEL BLACKJACK — MONTE CARLO SIMULATION');
  console.log('═'.repeat(60));
  console.log(`  Rules: S17, DAS=${DAS_ALLOWED}, no surrender, no re-split, infinite deck`);

  // Independent optimal-play RTP (used for chart reference and reporting)
  const optimal = computeOptimalRTP(SOFT17_RULE, DAS_ALLOWED);
  const optimalRTPpct = optimal.rtp * 100;
  console.log(`  Optimal-play RTP (independent engine): ${optimalRTPpct.toFixed(4)}%`);
  console.log(`  Pass 1: ${PASS1_STREAMS} streams × ${(PASS1_ROUNDS_EACH/1e6).toFixed(0)}M = ${(PASS1_ROUNDS_TOTAL/1e6).toFixed(0)}M hands`);
  console.log(`  Pass 2: casino seeds × ${PASS2_NONCES.toLocaleString()} nonces\n`);

  // ── Pass 1 ─────────────────────────────────────────────────────────────────

  const streamResults: any[] = [];
  const allProfits: number[] = [];
  const convergenceData: { rounds: number; rtp: number }[] = [];
  let totalWagered = 0, totalReturned = 0;

  const startP1 = Date.now();

  // RTP convention (matches optimal-play.ts engine and Wizard of Odds):
  //   RTP = 1 + E[net_profit_per_round] / initial_wager_per_round
  // where initial_wager = $1 per round and net_profit = playerReturn - totalWager.
  // Doubles and splits add to totalWager, but RTP is reported per ORIGINAL wager
  // so that the simulator and analytical engine are comparing the same metric.

  // Per-stream running RTP at each convergence checkpoint, so the
  // mean-of-streams convergence series can be computed after the loop.
  const perStreamConvergence: Map<number, number[]> = new Map(
    CONVERGENCE_POINTS.map(cp => [cp, []])
  );

  for (let s = 0; s < PASS1_STREAMS; s++) {
    // Pinned seed pair from SIM_SEEDS (generated once via crypto.randomBytes,
    // hardcoded above). Same seeds every run → reproducible numbers across
    // reviewers. No casino data is used as input.
    const seed = SIM_SEEDS[s];
    const keyBuffer = Buffer.from(seed.server, 'hex');

    const outcomes: Record<string, number> = { win: 0, lose: 0, push: 0, blackjack: 0, bust: 0 };
    // First card (cursor 0) rank census for the per-stream uniformity test (profile BLACKJACK-20),
    // re-derived by verify Step 17 from these counts.
    const firstCardRanks: Record<string, number> = Object.fromEntries(FIRST_CARD_RANKS.map(r => [r, 0]));
    let streamWagered = 0, streamReturned = 0;
    let streamSumProfit = 0, streamSumProfitSq = 0;
    const streamProfits: number[] = [];
    let runningProfit = 0;

    for (let n = 0; n < PASS1_ROUNDS_EACH; n++) {
      const result = simulateHand(keyBuffer, seed.client, n);
      outcomes[result.outcome]++;
      firstCardRanks[getCardWithKey(keyBuffer, seed.client, n, 0).slice(0, -1)]++;
      streamWagered += result.wager;
      streamReturned += result.playerReturn;
      // Profit per round (= playerReturn − totalWager). For a $1 initial wager
      // this is also the per-initial profit ratio. RTP = 1 + mean(profit).
      const profit = result.playerReturn - result.wager;
      streamSumProfit += profit;
      streamSumProfitSq += profit * profit;
      streamProfits.push(profit);
      runningProfit += profit;

      // Per-stream running RTP at each checkpoint — per-initial-wager convention
      for (const cp of CONVERGENCE_POINTS) {
        if (n + 1 === cp) {
          perStreamConvergence.get(cp)!.push(1 + runningProfit / cp);
        }
      }

      if (n % 100_000 === 0) progressBar(s * PASS1_ROUNDS_EACH + n, PASS1_ROUNDS_TOTAL, 'Pass 1', startP1);
    }

    const meanProfit = streamSumProfit / PASS1_ROUNDS_EACH;
    const streamRTP = 1 + meanProfit;
    // Sample variance of per-round profit (n-1 denominator).
    const varProfit = (streamSumProfitSq - PASS1_ROUNDS_EACH * meanProfit * meanProfit) / (PASS1_ROUNDS_EACH - 1);
    // SE of streamRTP = SE of meanProfit (initial wager is constant $1).
    const seRTP = Math.sqrt(varProfit / PASS1_ROUNDS_EACH);

    // Lag-1 autocorrelation + runs test on per-round profits
    const lag = lag1Auto(streamProfits);
    const runs = runsTest(streamProfits);

    streamResults.push({
      stream: s,
      rtp: streamRTP,
      outcomes,
      seRTP,
      lag1R: lag.r,
      lag1Z: lag.z,
      runsZ: runs.z,
      runsP: runs.pValue,
      firstCardRanks,
      wagered: streamWagered,
    });

    totalWagered += streamWagered;
    totalReturned += streamReturned;
    // Subsample for serial independence on the combined cross-stream stream
    for (let i = 0; i < streamProfits.length; i += 10) {
      allProfits.push(streamProfits[i]);
    }
  }

  // Mean-of-streams convergence series (framework rule)
  for (const cp of CONVERGENCE_POINTS) {
    const series = perStreamConvergence.get(cp)!;
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    convergenceData.push({ rounds: cp, rtp: mean });
  }

  progressBar(PASS1_ROUNDS_TOTAL, PASS1_ROUNDS_TOTAL, 'Pass 1', startP1);
  console.log('');

  // Per-initial-wager RTP across all streams (matches engine convention).
  const simRTP = 1 + (totalReturned - totalWagered) / PASS1_ROUNDS_TOTAL;
  const expectedRTP = optimal.rtp;

  // Per-stream goodness-of-fit z-test against the analytical optimal-play RTP
  // (independent reference from src/optimal-play.ts). Each p-value is a proper
  // two-sided z-test of the observed stream RTP against the engine's expected
  // value; Fisher's method then combines the 10 independent stream p-values
  // into a single chi-squared(2 × streams) statistic.
  const streamPValues: number[] = [];
  for (const sr of streamResults) {
    const z = sr.seRTP > 0 ? (sr.rtp - expectedRTP) / sr.seRTP : 0;
    const p = 2 * (1 - normalCDF(Math.abs(z)));
    streamPValues.push(Math.max(p, 1e-10));
  }
  const fisherStat = -2 * streamPValues.reduce((sum, p) => sum + Math.log(p), 0);
  const fisherDf = 2 * PASS1_STREAMS;
  const fisherP = chi2PValue(fisherStat, fisherDf);

  // Per-stream serial independence with Bonferroni correction. α = 0.01 across
  // 10 streams → α/N = 0.001 per stream. For the lag-1 z-test the matching
  // two-sided z critical is ≈ 3.291; for the runs test we compare the raw
  // p-value to α/N.
  const ALPHA_FAMILY = SERIAL_ALPHA_FAMILY;
  const ALPHA_PER_STREAM = ALPHA_FAMILY / PASS1_STREAMS;
  // Inverse standard normal at 1 - α/2 (two-sided); Newton on normalCDF (src/stats.ts).
  const Z_CRIT_BONF = inverseNormalCDF(1 - ALPHA_PER_STREAM / 2);

  let streamsFlaggedSerial = 0;
  for (const sr of streamResults) {
    const flagLag = Math.abs(sr.lag1Z) > Z_CRIT_BONF;
    const flagRuns = sr.runsP < ALPHA_PER_STREAM;
    if (flagLag || flagRuns) streamsFlaggedSerial++;
  }
  // For backwards compatibility with the existing Step 17 reader we keep the
  // combined-stream lag/runs values but the AUTHORITATIVE serial result is the
  // per-stream Bonferroni count above.
  const subSample = allProfits.length > 100_000 ? allProfits.slice(0, 100_000) : allProfits;
  const combinedLag = lag1Auto(subSample);
  const combinedRuns = runsTest(subSample);
  const serialFails = streamsFlaggedSerial;

  console.log(`  Pass 1 complete: ${(PASS1_ROUNDS_TOTAL/1e6).toFixed(0)}M hands in ${((Date.now()-startP1)/1000).toFixed(1)}s`);
  console.log(`  Simulated RTP: ${(simRTP * 100).toFixed(4)}% (vs analytical ${(expectedRTP * 100).toFixed(4)}%)`);
  console.log(`  Fisher's p: ${fisherP.toFixed(6)} (T=${fisherStat.toFixed(2)}, df=${fisherDf}) — per-stream z-test against analytical RTP`);
  console.log(`  Streams flagged for serial dependence (Bonferroni α/N=${ALPHA_PER_STREAM.toFixed(4)}): ${streamsFlaggedSerial}/${PASS1_STREAMS}`);
  console.log(`  Combined-stream lag-1 z: ${combinedLag.z.toFixed(2)}, runs p: ${combinedRuns.pValue.toFixed(4)} (informational)\n`);

  // ── Pass 2 ─────────────────────────────────────────────────────────────────

  console.log('  Pass 2 — Casino seed cherry-pick detection...');
  const startP2 = Date.now();

  const ds = loadDataset();
  const seedMap = buildSeedMap(ds.bets, ds.seeds);
  const casinoSeeds = [...seedMap.entries()];

  let chi2Fails = 0, flaggedSeeds = 0, testCFlags = 0;
  const perSeedResults: any[] = [];

  for (let si = 0; si < casinoSeeds.length; si++) {
    const [hash, serverSeed] = casinoSeeds[si];
    const keyBuffer = Buffer.from(serverSeed, 'hex');
    const clientSeed = ds.bets.find(b => b.server_seed_hashed === hash)?.client_seed || 'default';

    let earlyReturned = 0, extendedReturned = 0;
    const earlyReturns: number[] = [];
    const extendedReturns: number[] = [];
    // Test C (src/cherry-pick.ts): every hand's gross return in half-stakes, and the first-card census.
    const halfReturns = new Int32Array(PASS2_NONCES);
    const firstCardRanks: Record<string, number> = Object.fromEntries(FIRST_CARD_RANKS.map(r => [r, 0]));
    const capturedNonces = ds.bets.filter(b => b.server_seed_hashed === hash).map(b => b.nonce).sort((a, b) => a - b);

    for (let n = 0; n < PASS2_NONCES; n++) {
      const result = simulateHand(keyBuffer, clientSeed, n);
      halfReturns[n] = Math.round(2 * result.playerReturn);
      firstCardRanks[getCardWithKey(keyBuffer, clientSeed, n, 0).slice(0, -1)]++;
      if (n < EARLY_WINDOW) {
        earlyReturned += result.playerReturn;
        earlyReturns.push(result.playerReturn);
      } else {
        extendedReturned += result.playerReturn;
        extendedReturns.push(result.playerReturn);
      }
    }

    // NOTE: these are AVG RETURN PER HAND (not "RTP") — the per-hand returns
    // include the original wager + profit on win/push, so values around 0.99
    // would be RTP but doubled hands return up to 4× and pump the average
    // above 1. The cherry-pick test is a relative comparison between early
    // and extended windows that share the same denominator.
    const earlyAvgReturn = earlyReturned / EARLY_WINDOW;
    const extendedAvgReturn = extendedReturned / (PASS2_NONCES - EARLY_WINDOW);

    const extMean = extendedReturns.reduce((a, b) => a + b, 0) / extendedReturns.length;
    let extVar = 0;
    for (const r of extendedReturns) extVar += (r - extMean) ** 2;
    extVar /= extendedReturns.length;

    // Two-sample standard error of (early - extended) means, both estimated
    // from the extended window's per-hand variance (the most accurate
    // available estimate of the per-hand SD; early window is too small).
    const extN = PASS2_NONCES - EARLY_WINDOW;
    const se = Math.sqrt(extVar * (1 / EARLY_WINDOW + 1 / extN));
    const z = se > 0 ? (earlyAvgReturn - extMean) / se : 0;
    const p = 2 * (1 - normalCDF(Math.abs(z)));
    const flagged = p < CHERRY_ALPHA;
    if (flagged) flaggedSeeds++;
    const windows = windowSums(halfReturns, capturedNonces);
    const c = testC(windows);
    if (c.flag) testCFlags++;

    perSeedResults.push({
      hash: hash.substring(0, 16),
      earlyAvgReturn,
      extendedAvgReturn,
      flagged,
      // The two quantities the flag decision needs and the artifact did not ship, so verify Step 18
      // can re-derive every seed's decision from the row (profile BLACKJACK-21).
      extendedVar: extVar,
      z,
      // Test C (profile BLACKJACK-21): the served window (the captured nonces) then the 199 null
      // windows, as integer half-stake sums; the pre-registered decision; the first-card census.
      windowReturnHalf: windows,
      testC_rank: c.rank,
      testC_flag: c.flag,
      firstCardRanks,
    });

    if (si % 20 === 0) progressBar(si, casinoSeeds.length, 'Pass 2', startP2);
  }

  progressBar(casinoSeeds.length, casinoSeeds.length, 'Pass 2', startP2);
  console.log('');

  // Binomial test on flag count
  const expectedFlags = casinoSeeds.length * CHERRY_ALPHA;
  const binomP = binomialP(casinoSeeds.length, flaggedSeeds, CHERRY_ALPHA);

  console.log(`  Pass 2 complete: ${casinoSeeds.length} seeds × ${PASS2_NONCES.toLocaleString()} nonces in ${((Date.now()-startP2)/1000).toFixed(1)}s`);
  console.log(`  Flagged: ${flaggedSeeds} (expected ~${expectedFlags.toFixed(1)})`);
  console.log(`  Binomial p: ${binomP.toFixed(6)}`);
  console.log(`  Test C (served window vs its own 199-window null, one-sided): ${testCFlags} flagged (FAIL above ${flagBound(casinoSeeds.length, TEST_C_NULL_P).toFixed(2)})\n`);

  // ── Write results ──────────────────────────────────────────────────────────

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // NO RUN METADATA (profile rules.reproduction): the artifact carries only what the run computed,
  // so a regeneration on the pinned SIM_SEEDS reproduces its bytes. (It carried `generatedAt` until
  // 2026-09-24.)
  const simResults = {
    rules: {
      soft17: SOFT17_RULE,
      doubleAfterSplit: DAS_ALLOWED,
      surrender: false,
      reSplit: false,
      deck: 'infinite',
    },
    optimalPlay: {
      rtp: optimal.rtp,
      edge: optimal.edge,
      playerBJFreq: optimal.playerBJFreq,
      dealerBJFreq: optimal.dealerBJFreq,
      source: 'src/optimal-play.ts (independent recursive infinite-deck EV solver)',
      // LEGACY FIELD NAMES, kept so the pinned artifact regenerates byte for byte: `wooReference` is
      // NOT a Wizard of Odds figure (retired 2026-09-25, src/config.ts) and nothing scores it.
      wooReference: RETIRED_FIGURE_FORMERLY_CALLED_WOO,
      wooDelta: optimal.rtp - RETIRED_FIGURE_FORMERLY_CALLED_WOO,
    },
    pass1: {
      totalRounds: PASS1_ROUNDS_TOTAL,
      streams: PASS1_STREAMS,
      roundsPerStream: PASS1_ROUNDS_EACH,
      streamResults,
      // Per-stream z-test against analytical RTP, Fisher-combined.
      // Independent reference: src/optimal-play.ts.
      fisherCombined: {
        statistic: fisherStat,
        df: fisherDf,
        pValue: fisherP,
        method: 'per-stream z-test of streamRTP against analytical optimal-play RTP, Fisher-combined',
        analyticalReference: expectedRTP,
      },
      simulatedRTP: simRTP,
      // Number of streams whose per-stream serial test (lag-1 OR runs) flags
      // at the Bonferroni-corrected per-stream alpha. THIS is the authoritative
      // serial-independence count — combined-stream values below are informational.
      serialIndependenceFails: serialFails,
      streamsFlaggedSerial,
      bonferroni: {
        alphaFamily: ALPHA_FAMILY,
        alphaPerStream: ALPHA_PER_STREAM,
        zCriticalTwoSided: Z_CRIT_BONF,
      },
      lag1Autocorrelation: combinedLag.r,
      runsTest: combinedRuns,
      convergence: convergenceData,
    },
    pass2: {
      totalSeeds: casinoSeeds.length,
      noncesPerSeed: PASS2_NONCES,
      flaggedSeeds,
      cherryPickBinomial: binomP,
      testC: {
        windowSize: TEST_C_WINDOW,
        windowsPerSeed: TEST_C_WINDOWS,
        alpha: TEST_C_ALPHA,
        flagRank: TEST_C_FLAG_RANK,
        nullFlagProbability: TEST_C_NULL_P,
        flags: testCFlags,
        failAbove: flagBound(casinoSeeds.length, TEST_C_NULL_P),
      },
      perSeed: perSeedResults,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, 'simulation-results.json'), JSON.stringify(simResults, null, 2));
  console.log(`  Written: ${OUT_LABEL}/simulation-results.json`);

  // ── RTP Convergence Chart ──────────────────────────────────────────────────

  const chartHtml = renderConvergenceHtml({
    streams: PASS1_STREAMS, roundsPerStream: PASS1_ROUNDS_EACH, totalRounds: PASS1_ROUNDS_TOTAL,
    convergence: convergenceData, simulatedRTP: simRTP, engineRTP: optimal.rtp,
    fisherP, fisherT: fisherStat, fisherDf, serialFails,
  });

  fs.writeFileSync(path.join(OUT_DIR, 'rtp-convergence.html'), chartHtml);
  console.log(`  Written: ${OUT_LABEL}/rtp-convergence.html`);
  if (PF_EMIT) console.log('  REPORT GENERATION (PF_EMIT=1): the pinned artifacts in outputs/ were rewritten — re-pin them in src/artifact-pins.ts.');
  else console.log('  Committed artifacts NOT modified.');

  console.log('\n' + '═'.repeat(60));
  console.log('  DONE');
  console.log('═'.repeat(60));
}

main().catch(console.error);
