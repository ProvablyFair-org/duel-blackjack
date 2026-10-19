/**
 * PASS 2, TEST C — the served-window return against the seed's own null (profile BLACKJACK-21).
 * Ported from Duel Mines Test C (pf-duel-workspace/games/mines, src/sim-census.ts + tests/steps/
 * simulation.ts Step 19) and HouseBets Mines Step 18. Shared by src/simulate.ts (which writes the
 * rows) and verify Step 18 (which REPLAYS every window from the revealed seeds and re-derives every
 * figure), so the two cannot disagree about the rule.
 *
 * THE QUESTION. A casino that could see the outcomes a server seed will produce could hand out only
 * the seeds whose first games go badly for the player. For each revealed seed the declared strategy
 * (src/strategy.ts, the one Pass 1 plays) is played on nonces 0 … 9,999 and every hand's gross return
 * is summed per window of 50:
 *   - the SERVED window is exactly the 50 nonces the capture played on that seed (from the dataset —
 *     0–49 on 113 epochs; on the 7 epochs with a capture-retry gap, 0–50 less the gap nonce);
 *   - the NULL is the other 9,950 nonces, in order, in 199 blocks of 50: the same statistic under the
 *     same seed, client seed and strategy — an empirical block null, exact under exchangeability.
 * PRE-REGISTERED ONE-SIDED RULE (fixed here before any row was generated, 2026-09-24): rank = the
 * number of null windows whose return is ≤ the served window's (ties count AGAINST flagging), p =
 * (1 + rank) / 200, flag at p < 0.05 ⇔ rank ≤ 8, so the null flag probability is at most 9/200. The
 * audit FAILs when the flag count exceeds N · 9/200 + 5σ + 1. Only a LOW served window flags: a pick
 * that favours the player is not an attack on the player.
 *
 * Returns are carried in HALF-STAKES (gross return × 2) so every window sum is an exact integer.
 */
import { PASS2_NONCES, EARLY_WINDOW } from './sim-plan';

export const TEST_C_WINDOW = EARLY_WINDOW;                         // 50
export const TEST_C_WINDOWS = PASS2_NONCES / TEST_C_WINDOW;        // 200 (1 served + 199 null)
export const TEST_C_ALPHA = 0.05;
/** Largest rank that flags: (1 + rank) / TEST_C_WINDOWS < TEST_C_ALPHA. */
export const TEST_C_FLAG_RANK = Math.ceil(TEST_C_ALPHA * TEST_C_WINDOWS) - 2;       // 8
/** Null flag probability with no ties: (TEST_C_FLAG_RANK + 1) / TEST_C_WINDOWS = 9/200. */
export const TEST_C_NULL_P = (TEST_C_FLAG_RANK + 1) / TEST_C_WINDOWS;
/** Secondary screen: first-card rank census per seed, χ² 12 df, flagged below this p. */
export const SCREEN_ALPHA = 0.001;
/** Return-selecting attacker: serves the lowest-returning of K candidate windows. */
export const ATTACK_K = [2, 5, 10, 20] as const;
export const ATTACK_F = [0.1, 0.25, 0.5] as const;

/** [served window, 199 null windows] from per-nonce half-stake returns and the captured nonces. */
export function windowSums(halfReturns: ArrayLike<number>, capturedNonces: number[]): number[] {
  if (halfReturns.length !== PASS2_NONCES) throw new Error(`${halfReturns.length} nonces, plan ${PASS2_NONCES}`);
  const served = new Set(capturedNonces);
  if (served.size !== TEST_C_WINDOW || capturedNonces.some(n => !Number.isInteger(n) || n < 0 || n >= PASS2_NONCES))
    throw new Error(`served window must be ${TEST_C_WINDOW} distinct nonces in [0, ${PASS2_NONCES})`);
  let early = 0;
  const rest: number[] = [];
  for (let n = 0; n < PASS2_NONCES; n++) (served.has(n) ? (early += halfReturns[n]) : rest.push(halfReturns[n]));
  const out = [early];
  for (let w = 0; w < TEST_C_WINDOWS - 1; w++) {
    let s = 0;
    for (let i = 0; i < TEST_C_WINDOW; i++) s += rest[w * TEST_C_WINDOW + i];
    out.push(s);
  }
  return out;
}

/** The pre-registered decision for one seed. */
export function testC(windows: number[]): { rank: number; p: number; flag: boolean } {
  const early = windows[0];
  const rank = windows.slice(1).filter(x => x <= early).length;
  const p = (1 + rank) / windows.length;
  return { rank, p, flag: p < TEST_C_ALPHA };
}

export const flagBound = (n: number, p: number): number => n * p + 5 * Math.sqrt(n * p * (1 - p)) + 1;

/** C(n, k) as a float via logs (n ≤ a few hundred here). */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/**
 * EXACT per-seed detection probability against a best-of-K attacker, no ties: the served window is
 * the minimum of K draws and the null holds M draws, all from one continuous distribution, so the
 * labels' order is a uniform arrangement and P(rank = j) = C(K + M − j − 1, K − 1) / C(K + M, K).
 * Window sums are integers and tie, and the measurement below uses a smaller null (199 − K windows)
 * over only 120 seeds, so the two figures are reported side by side and neither bounds the other.
 */
export function bestOfKFlagProbability(K: number, M = TEST_C_WINDOWS - 1, flagRank = TEST_C_FLAG_RANK): number {
  let p = 0;
  for (let j = 0; j <= flagRank; j++) p += Math.exp(logChoose(K + M - j - 1, K - 1) - logChoose(K + M, K));
  return p;
}

/**
 * MEASURED per-seed detection rate against a best-of-K attacker, on the replayed windows themselves
 * (ties included): for every seed the attacker's candidates are null windows 1 … K, it serves the
 * lowest, and that value is ranked against the seed's remaining 199 − K null windows under the same
 * rule, p = (1 + rank) / (200 − K) < 0.05.
 */
export function measuredBestOfK(allWindows: number[][], K: number): number {
  let flags = 0;
  for (const w of allWindows) {
    const cand = w.slice(1, 1 + K), rest = w.slice(1 + K);
    const served = Math.min(...cand);
    const rank = rest.filter(x => x <= served).length;
    if ((1 + rank) / (rest.length + 1) < TEST_C_ALPHA) flags++;
  }
  return flags / allWindows.length;
}

/** P(X > bound) for X ~ Binomial(n, p), summed term by term in log space (Duel Mines sim-census.ts). */
export function binomialUpperTail(n: number, p: number, bound: number): number {
  const kMin = Math.floor(bound) + 1;
  if (kMin > n || p <= 0) return 0;
  if (p >= 1) return 1;
  let logC = 0, total = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) logC += Math.log(n - k + 1) - Math.log(k);
    if (k >= kMin) total += Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  return Math.min(1, total);
}

/** Audit-level power: a fraction f of the N seeds is picked (per-seed flag probability pK), the rest are honest. */
export function auditPower(n: number, f: number, pK: number): number {
  return binomialUpperTail(n, f * pK + (1 - f) * TEST_C_NULL_P, flagBound(n, TEST_C_NULL_P));
}
