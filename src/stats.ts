/**
 * Statistical functions shared by the simulator (src/simulate.ts) and the verifier
 * (tests/steps/simulation.ts). One copy, so the verifier's recomputation of Fisher's p, the
 * serial-independence flags and the cherry-pick binomial tail from the artifact's raw rows runs
 * the same arithmetic that produced the artifact, and can therefore be held to exact equality.
 *
 * Moved verbatim out of src/simulate.ts (2026-09-23); the pinned simulation-results.json was
 * regenerated from this code and re-reproduced after the move.
 */

export function lnGamma(z: number): number {
  const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1; let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function gammaLower(a: number, x: number): number {
  let sum = 1 / a, term = 1 / a;
  for (let n = 1; n <= 200; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-15) break; }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

export function gammaUpper(a: number, x: number): number {
  let f = 1e-30, C = f, D = 0;
  for (let i = 1; i <= 200; i++) { const an = i * (a - i), bn = x + 2 * i + 1 - a; D = bn + an * D; if (Math.abs(D) < 1e-30) D = 1e-30; D = 1 / D; C = bn + an / C; if (Math.abs(C) < 1e-30) C = 1e-30; f *= C * D; if (Math.abs(C * D - 1) < 1e-15) break; }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) / (x + 1 - a + 1 / f);
}

export function chi2PValue(stat: number, df: number): number {
  if (stat <= 0) return 1;
  const a = df / 2, x = stat / 2;
  return x < a + 1 ? 1 - gammaLower(a, x) : gammaUpper(a, x);
}

// Complementary error function — the Numerical Recipes `erfcc` Chebyshev fit (Press, Teukolsky,
// Vetterling & Flannery, Numerical Recipes in C, 2nd ed., §6.2): erfc(x) ≈ t·exp(−x² + P(t)),
// t = 1/(1 + x/2). Its stated FRACTIONAL error is < 1.2e-7 for all x; measured against mpmath at
// 50 digits on (0, 20] in steps of 1e-4 the largest is 1.045e-7 (at x ≈ 4.74). It is NOT a
// 1e-15-accurate Cody (1969) rational approximation, which an earlier comment here claimed.
//
// Why it replaced the previous normalCDF: that function evaluated the Abramowitz–Stegun 7.1.26
// erf polynomial with t = 1/(1 + 0.3275911·|z|) but exp(−z²/2) — the polynomial's argument must be
// z/√2 as well. The mismatch was a plain bug, not a precision limit: at z = 1.96 it returned a
// one-sided tail of 0.01902 against the true 0.02500, and it put the Bonferroni critical value at
// 3.2026 instead of 3.2905. The 1.2e-7 fractional error of this fit moves that critical value by
// 1.9e-8 (3.2905267507 here vs 3.2905267315 exact).
export function erfc(x: number): number {
  const ax = Math.abs(x);
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

export function normalCDF(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Inverse standard normal CDF by Newton iteration on normalCDF. */
export function inverseNormalCDF(targetCDF: number): number {
  let z = 0;
  for (let i = 0; i < 60; i++) {
    const cdf = normalCDF(z);
    const pdf = Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
    if (pdf < 1e-30) break;
    z = z + (targetCDF - cdf) / pdf;
  }
  return z;
}

/** Upper binomial tail P(X >= k), X ~ Binomial(n, p). */
export function binomialP(n: number, k: number, p: number): number {
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
