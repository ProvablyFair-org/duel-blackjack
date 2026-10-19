/**
 * MONEY — exact, on the declared 18-decimal grid.
 *
 * Duel serves every amount as a decimal string with at most 18 fractional digits
 * (`amount_currency` "0.010000000000000000", `amount_won` "0.11", side `amount_won` "1.212307692").
 * Until 2026-09-24 the suite compared money after parseFloat, first at ±1e-6 and then at a relative
 * 1e-12; a double cannot hold 0.01 or 121.2307692 exactly, so a float comparison is a tolerance by
 * construction. Money is now compared EXACTLY (profile BLACKJACK-11): every amount is parsed to an
 * integer count of GRID units (1 unit = 1e-18), every multiplier to an exact rational (a decimal
 * string is num / 10^k), and a recomputed payout must equal the served one with zero residual. An
 * amount that is not on the grid (more than 18 fractional digits, a sign, an exponent, anything but
 * digits and one dot) is OFF-GRID and fails the step that reads it.
 *
 * MONEY_REL_TOL / moneyAgree remain ONLY for the non-money comparisons that still use floats; no
 * payout step uses them.
 */
export const GRID_DECIMALS = 18;
export const GRID = 10n ** BigInt(GRID_DECIMALS);

/** Parse a non-negative decimal string to grid units; null when it is not on the grid. */
export function toUnits(s: unknown): bigint | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > GRID_DECIMALS) return null;
  return BigInt(m[1]) * GRID + BigInt((frac + '0'.repeat(GRID_DECIMALS)).slice(0, GRID_DECIMALS));
}

/** An exact rational num/den with den > 0. */
export interface Rational { num: bigint; den: bigint }

/**
 * A multiplier as an exact rational. Accepts a decimal string or a JS number; a number is taken by
 * its shortest round-trip decimal (String(n)), which for every served multiplier in this capture is
 * the literal the operator wrote (e.g. 121.2307692). Returns null for anything that is not a
 * non-negative finite decimal.
 */
export function toRational(x: unknown): Rational | null {
  const s = typeof x === 'number' ? (Number.isFinite(x) ? String(x) : '') : typeof x === 'string' ? x : '';
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  return { num: BigInt(m[1] + frac), den: 10n ** BigInt(frac.length) };
}

/** units × rational, as an exact rational (still in grid units). */
export const mulUnits = (u: bigint, r: Rational): Rational => ({ num: u * r.num, den: r.den });

/** Exact equality of a rational amount (in grid units) with served grid units. */
export const exactEquals = (expected: Rational, actualUnits: bigint): boolean =>
  expected.num === actualUnits * expected.den;

/** Sum of rationals over a common denominator. */
export function addRational(a: Rational, b: Rational): Rational {
  return a.den === b.den ? { num: a.num + b.num, den: a.den } : { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
}

/** Display grid units as a decimal string (for step details only; never compared). */
export function unitsToString(u: bigint): string {
  const neg = u < 0n; const a = neg ? -u : u;
  const i = a / GRID, f = (a % GRID).toString().padStart(GRID_DECIMALS, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + i.toString() + (f ? '.' + f : '');
}

/** Display an exact rational (grid units) — exact when it lands on the grid, else a fraction. */
export function rationalToString(r: Rational): string {
  return r.num % r.den === 0n ? unitsToString(r.num / r.den) : `${r.num}/${r.den} units`;
}

// ── Float comparison, kept for NON-MONEY figures only ─────────────────────────
export const MONEY_REL_TOL = 1e-12;
export const moneyTol = (x: number): number => MONEY_REL_TOL * Math.max(Math.abs(x), 1);
export const moneyAgree = (expected: number, actual: number): boolean =>
  Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(expected - actual) <= moneyTol(expected);
