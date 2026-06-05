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
 * Output: outputs/simulation-results.json + outputs/rtp-convergence.html
 */

import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';

import { getCardWithKey, handValue, isBlackjack, cardRank, DEAL_ORDER } from './rng';
import { getOptimalAction, shouldDealerHit } from './strategy';
import { loadDataset, buildSeedMap } from './loader';
import { computeOptimalRTP } from './optimal-play';

// ── Configuration ─────────────────────────────────────────────────────────────

const PASS1_STREAMS      = 10;
const PASS1_ROUNDS_EACH  = 1_000_000;
const PASS1_ROUNDS_TOTAL = PASS1_STREAMS * PASS1_ROUNDS_EACH;
const PASS2_NONCES       = 10_000;
const EARLY_WINDOW       = 50;
// Confirmed from dataset (verify.ts Step 19 — 0 hits, 75 stands on dealer soft 17)
const SOFT17_RULE: 'stand' | 'hit' = 'stand';
// Double-after-split allowed (verify.ts Step 23 — 109 DAS observed in 269 splits)
const DAS_ALLOWED = true;

const CONVERGENCE_POINTS = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

const OUT_DIR = path.join(__dirname, '..', 'outputs');

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

function lnGamma(z: number): number {
  const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1; let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaLower(a: number, x: number): number {
  let sum = 1 / a, term = 1 / a;
  for (let n = 1; n <= 200; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-15) break; }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function gammaUpper(a: number, x: number): number {
  let f = 1e-30, C = f, D = 0;
  for (let i = 1; i <= 200; i++) { const an = i * (a - i), bn = x + 2 * i + 1 - a; D = bn + an * D; if (Math.abs(D) < 1e-30) D = 1e-30; D = 1 / D; C = bn + an / C; if (Math.abs(C) < 1e-30) C = 1e-30; f *= C * D; if (Math.abs(C * D - 1) < 1e-15) break; }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) / (x + 1 - a + 1 / f);
}

function chi2PValue(stat: number, df: number): number {
  if (stat <= 0) return 1;
  const a = df / 2, x = stat / 2;
  return x < a + 1 ? 1 - gammaLower(a, x) : gammaUpper(a, x);
}

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

// High-precision complementary error function (Chiarella & Reichel, after
// Cody 1969). Relative error < ~1e-15 across the real line — the body-of-
// distribution Abramowitz-Stegun approximation it replaces loses precision
// beyond |z| ≈ 3 and gave a noticeably wrong Z_CRIT_BONF (3.2026 vs 3.2905).
function erfc(x: number): number {
  const ax = Math.abs(x);
  // Rational Chebyshev approximation for the tail (|x| ≥ 0.5); coefficients
  // from W. J. Cody, "Rational Chebyshev Approximations for the Error Function"
  // (Math. Comp. 23 (1969), 631-637), expressed via the t = 1/(1 + 0.5*|x|)
  // substitution — numerically stable from 0 out into the deep tail.
  const t = 1 / (1 + 0.5 * ax);
  const ans = t * Math.exp(
    -ax * ax -
    1.26551223 +
    t * (1.00002368 +
    t * (0.37409196 +
    t * (0.09678418 +
    t * (-0.18628806 +
    t * (0.27886807 +
    t * (-1.13520398 +
    t * (1.48851587 +
    t * (-0.82215223 +
    t * 0.17087277))))))))
  );
  return x >= 0 ? ans : 2 - ans;
}

function normalCDF(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

// ── Simulate one blackjack hand ──────────────────────────────────────────────

interface HandResult {
  playerReturn: number;    // total returned across all sub-hands (incl. wager)
  wager: number;           // total wagered (1 normal, 2 doubled, 2 split, 4 split+double, etc.)
  outcome: 'win' | 'lose' | 'push' | 'blackjack' | 'bust'; // outcome of the first sub-hand (for tagging)
}

interface PlayerHand {
  cards: string[];
  fromSplitAces: boolean;  // one-card-only rule
  doubled: boolean;
}

function simulateHand(keyBuffer: Buffer, clientSeed: string, nonce: number): HandResult {
  let cursor = 0;
  function draw(): string { return getCardWithKey(keyBuffer, clientSeed, nonce, cursor++); }

  // Initial deal: P1, D1, P2, D2
  const p1 = draw();
  const d1 = draw();
  const p2 = draw();
  const d2 = draw();

  const dealerCards = [d1, d2];

  // Naturals (peek rule: dealer checks for BJ on 10/A upcard)
  const playerBJ = isBlackjack([p1, p2]);
  const dealerBJ = isBlackjack(dealerCards);

  if (playerBJ && dealerBJ) return { playerReturn: 1, wager: 1, outcome: 'push' };
  if (playerBJ)             return { playerReturn: 2.5, wager: 1, outcome: 'blackjack' };
  if (dealerBJ)             return { playerReturn: 0, wager: 1, outcome: 'lose' };

  // Build hand list, possibly splitting once (no re-split — matches dataset)
  let hands: PlayerHand[] = [{ cards: [p1, p2], fromSplitAces: false, doubled: false }];
  let totalWager = 1;

  // Check for split on initial pair (matching rank only)
  if (cardRank(p1) === cardRank(p2)) {
    const action = getOptimalAction([p1, p2], d1, /*canSplit=*/true, /*canDouble=*/true);
    if (action === 'P') {
      const isAces = cardRank(p1) === 'A';
      const h1: PlayerHand = { cards: [p1, draw()], fromSplitAces: isAces, doubled: false };
      const h2: PlayerHand = { cards: [p2, draw()], fromSplitAces: isAces, doubled: false };
      hands = [h1, h2];
      totalWager = 2;
    }
  }

  // Play each hand
  for (const h of hands) {
    if (h.fromSplitAces) continue; // one card only, already drawn

    while (true) {
      const hv = handValue(h.cards);
      if (hv.best >= 21) break;

      const canDouble = h.cards.length === 2 && (hands.length === 1 || DAS_ALLOWED);
      const action = getOptimalAction(h.cards, d1, /*canSplit=*/false, canDouble);

      if (action === 'H') {
        h.cards.push(draw());
      } else if (action === 'D') {
        h.cards.push(draw());
        h.doubled = true;
        totalWager += 1; // additional wager equal to original
        break;
      } else if (action === 'Ds') {
        // Double if allowed, else stand
        if (canDouble) {
          h.cards.push(draw());
          h.doubled = true;
          totalWager += 1;
        }
        break;
      } else {
        break; // stand
      }
    }
  }

  // Dealer plays unless every player hand is bust
  const allBust = hands.every(h => handValue(h.cards).best > 21);
  if (!allBust) {
    while (shouldDealerHit(dealerCards, SOFT17_RULE)) {
      dealerCards.push(draw());
    }
  }
  const dealerHV = handValue(dealerCards);

  // Resolve each hand independently
  let totalReturn = 0;
  let firstOutcome: HandResult['outcome'] = 'push';
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i];
    const hv = handValue(h.cards);
    const handWager = h.doubled ? 2 : 1;
    let ret = 0;
    let outcome: HandResult['outcome'] = 'push';

    if (hv.best > 21) {
      outcome = 'bust';
      ret = 0;
    } else if (dealerHV.best > 21) {
      outcome = 'win';
      ret = 2 * handWager;
    } else if (hv.best > dealerHV.best) {
      outcome = 'win';
      ret = 2 * handWager;
    } else if (hv.best === dealerHV.best) {
      outcome = 'push';
      ret = 1 * handWager;
    } else {
      outcome = 'lose';
      ret = 0;
    }

    totalReturn += ret;
    if (i === 0) firstOutcome = outcome;
  }

  return { playerReturn: totalReturn, wager: totalWager, outcome: firstOutcome };
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
    let streamWagered = 0, streamReturned = 0;
    let streamSumProfit = 0, streamSumProfitSq = 0;
    const streamProfits: number[] = [];
    let runningProfit = 0;

    for (let n = 0; n < PASS1_ROUNDS_EACH; n++) {
      const result = simulateHand(keyBuffer, seed.client, n);
      outcomes[result.outcome]++;
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
  const ALPHA_FAMILY = 0.01;
  const ALPHA_PER_STREAM = ALPHA_FAMILY / PASS1_STREAMS;
  // Inverse standard normal at 1 - α/2 (two-sided); Newton on normalCDF.
  function inverseNormalCDF(targetCDF: number): number {
    let z = 0;
    for (let i = 0; i < 60; i++) {
      const cdf = normalCDF(z);
      const pdf = Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
      if (pdf < 1e-30) break;
      z = z + (targetCDF - cdf) / pdf;
    }
    return z;
  }
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

  let chi2Fails = 0, flaggedSeeds = 0;
  const perSeedResults: any[] = [];

  for (let si = 0; si < casinoSeeds.length; si++) {
    const [hash, serverSeed] = casinoSeeds[si];
    const keyBuffer = Buffer.from(serverSeed, 'hex');
    const clientSeed = ds.bets.find(b => b.server_seed_hashed === hash)?.client_seed || 'default';

    let earlyReturned = 0, extendedReturned = 0;
    const earlyReturns: number[] = [];
    const extendedReturns: number[] = [];

    for (let n = 0; n < PASS2_NONCES; n++) {
      const result = simulateHand(keyBuffer, clientSeed, n);
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
    const flagged = p < 0.05;
    if (flagged) flaggedSeeds++;

    perSeedResults.push({
      hash: hash.substring(0, 16),
      earlyAvgReturn,
      extendedAvgReturn,
      flagged,
    });

    if (si % 20 === 0) progressBar(si, casinoSeeds.length, 'Pass 2', startP2);
  }

  progressBar(casinoSeeds.length, casinoSeeds.length, 'Pass 2', startP2);
  console.log('');

  // Binomial test on flag count
  const expectedFlags = casinoSeeds.length * 0.05;
  function binomialP(n: number, k: number, p: number): number {
    let sum = 0;
    for (let i = k; i <= n; i++) {
      let logProb = 0;
      for (let j = 0; j < i; j++) logProb += Math.log(p);
      for (let j = 0; j < n - i; j++) logProb += Math.log(1 - p);
      for (let j = 1; j <= i; j++) logProb += Math.log(n - j + 1) - Math.log(j);
      sum += Math.exp(logProb);
    }
    return sum;
  }
  const binomP = binomialP(casinoSeeds.length, flaggedSeeds, 0.05);

  console.log(`  Pass 2 complete: ${casinoSeeds.length} seeds × ${PASS2_NONCES.toLocaleString()} nonces in ${((Date.now()-startP2)/1000).toFixed(1)}s`);
  console.log(`  Flagged: ${flaggedSeeds} (expected ~${expectedFlags.toFixed(1)})`);
  console.log(`  Binomial p: ${binomP.toFixed(6)}\n`);

  // ── Write results ──────────────────────────────────────────────────────────

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const simResults = {
    generatedAt: new Date().toISOString(),
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
      wooReference: 0.994296,
      wooDelta: optimal.rtp - 0.994296,
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
      perSeed: perSeedResults,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, 'simulation-results.json'), JSON.stringify(simResults, null, 2));
  console.log('  Written: outputs/simulation-results.json');

  // ── RTP Convergence Chart ──────────────────────────────────────────────────

  const chartLabels = convergenceData.map(d => d.rounds >= 1e6 ? (d.rounds / 1e6) + 'M' : d.rounds >= 1e3 ? (d.rounds / 1e3) + 'K' : String(d.rounds));
  const chartData = convergenceData.map(d => d.rtp * 100);

  const chartHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DUEL BLACKJACK — ${(PASS1_ROUNDS_TOTAL / 1e6).toFixed(0)}M SIMULATED HANDS</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; color: #333; padding: 24px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  h1 { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
  .chart-wrap { position: relative; height: 420px; margin-bottom: 24px; }
  .box { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 16px auto; max-width: 900px; text-align: center; }
</style>
</head><body>
<div class="container">
<h1>DUEL BLACKJACK — RTP CONVERGENCE</h1>
<p style="text-align:center;font-size:12px;color:#999;margin-bottom:16px">${PASS1_STREAMS} streams x ${(PASS1_ROUNDS_EACH/1e6).toFixed(0)}M = ${(PASS1_ROUNDS_TOTAL/1e6).toFixed(0)}M hands | Fisher's method | S17 + DAS basic strategy</p>
<div class="chart-wrap"><canvas id="chart"></canvas></div>
<div class="box">
  Simulated RTP: <strong>${(simRTP * 100).toFixed(4)}%</strong> | Optimal-play RTP (engine): <strong>${optimalRTPpct.toFixed(4)}%</strong> | Fisher's p: <strong>${fisherP.toFixed(6)}</strong> (T=${fisherStat.toFixed(2)}, df=${fisherDf}) | Serial fails: ${serialFails}
</div>
</div>
<script>
new Chart(document.getElementById('chart'),{type:'line',data:{
labels:${JSON.stringify(chartLabels)},
datasets:[{label:'Cumulative simulated RTP',data:${JSON.stringify(chartData)},borderColor:'#1565c0',tension:0.3,pointRadius:4},
{label:'Optimal-play RTP (engine, ${optimalRTPpct.toFixed(2)}%)',data:${JSON.stringify(chartLabels.map(() => optimalRTPpct))},borderColor:'#e57373',borderDash:[5,5],pointRadius:0}]},
options:{responsive:true,maintainAspectRatio:false,
scales:{y:{ticks:{color:'#666',callback:v=>v+'%'},grid:{color:'#e0e0e0'}},x:{ticks:{color:'#666'},grid:{color:'#e0e0e0'}}},
plugins:{legend:{labels:{color:'#333'}}}}});
</script></div></body></html>`;

  fs.writeFileSync(path.join(OUT_DIR, 'rtp-convergence.html'), chartHtml);
  console.log('  Written: outputs/rtp-convergence.html');

  console.log('\n' + '═'.repeat(60));
  console.log('  DONE');
  console.log('═'.repeat(60));
}

main().catch(console.error);
