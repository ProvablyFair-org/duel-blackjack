/**
 * VALUE DOMAINS for every numeric leaf of the JSON artifact of record (profile BLACKJACK-27: "every
 * numeric leaf has a declared value domain"). Ported from Duel Mines src/domains.ts.
 *
 * A SHA-256 pin proves an artifact has not changed since it was pinned; it says nothing about whether
 * a value was ever POSSIBLE — re-pinning a forged artifact is what a forger does next. So every
 * numeric leaf of outputs/simulation-results.json is also held to the domain it physically admits,
 * with every bound taken from CODE (src/sim-plan.ts, src/loader.ts), never from the artifact.
 *
 * REJECT ONLY THE IMPOSSIBLE: a domain is physical possibility, not plausibility. NO SILENT
 * FALLBACK: a numeric leaf whose collapsed path matches no rule is reported like an impossible one,
 * so a new numeric field cannot enter the artifact without a declared domain (Step 34).
 *
 * The physical bounds used: per round the player stakes at most 4 units (split + double on both
 * hands) and gets back at most 8 (two doubled wins), so a per-round profit lies in [−4, +4], a
 * per-initial-bet RTP (1 + mean profit) in [−3, 5], and an average gross return per hand in [0, 8].
 */
import { PASS1_STREAMS, PASS1_ROUNDS_EACH, PASS1_ROUNDS_TOTAL, PASS2_NONCES } from './sim-plan';
import { EXPECTED_EPOCHS } from './loader';

export interface Domain { label: string; ok: (v: number) => boolean }
const D = (label: string, ok: (v: number) => boolean): Domain => ({ label, ok });
const FINITE = D('a finite number', v => Number.isFinite(v));
const NONNEG = D('a non-negative real', v => Number.isFinite(v) && v >= 0);
const PROB   = D('a probability in [0,1]', v => Number.isFinite(v) && v >= 0 && v <= 1);
const CORR   = D('a correlation in [-1,1]', v => Number.isFinite(v) && v >= -1 && v <= 1);
const intIn  = (lo: number, hi: number, what: string) => D(`an integer in [${lo}, ${hi}] (${what})`, v => Number.isInteger(v) && v >= lo && v <= hi);
const realIn = (lo: number, hi: number, what: string) => D(`a real in [${lo}, ${hi}] (${what})`, v => Number.isFinite(v) && v >= lo && v <= hi);

const RTP     = realIn(-3, 5, 'per-initial-bet RTP: 1 + mean profit, profit in [−4, 4]');
const PER_STREAM = intIn(0, PASS1_ROUNDS_EACH, 'rounds in one Pass-1 stream');

interface Rule { path: RegExp; domain: Domain }
export const DOMAIN_RULES: Record<string, Rule[]> = {
  'simulation-results.json': [
    { path: /^\.optimalPlay\.(rtp)$/, domain: RTP },
    { path: /^\.optimalPlay\.edge$/, domain: realIn(-4, 4, 'edge = 1 − RTP') },
    { path: /^\.optimalPlay\.(playerBJFreq|dealerBJFreq|wooReference)$/, domain: PROB },
    { path: /^\.optimalPlay\.wooDelta$/, domain: FINITE },
    { path: /^\.pass1\.totalRounds$/, domain: intIn(0, PASS1_ROUNDS_TOTAL, 'Pass-1 rounds') },
    { path: /^\.pass1\.streams$/, domain: intIn(0, PASS1_STREAMS, 'Pass-1 streams') },
    { path: /^\.pass1\.roundsPerStream$/, domain: PER_STREAM },
    { path: /^\.pass1\.streamResults\[\]\.stream$/, domain: intIn(0, PASS1_STREAMS - 1, 'stream index') },
    { path: /^\.pass1\.streamResults\[\]\.rtp$/, domain: RTP },
    { path: /^\.pass1\.streamResults\[\]\.outcomes\.(win|lose|push|blackjack|bust)$/, domain: PER_STREAM },
    { path: /^\.pass1\.streamResults\[\]\.firstCardRanks\.(2|3|4|5|6|7|8|9|10|J|Q|K|A)$/, domain: PER_STREAM },
    { path: /^\.pass1\.streamResults\[\]\.wagered$/, domain: intIn(PASS1_ROUNDS_EACH, 4 * PASS1_ROUNDS_EACH, 'units staked: 1 to 4 per round') },
    { path: /^\.pass1\.streamResults\[\]\.seRTP$/, domain: NONNEG },
    { path: /^\.pass1\.streamResults\[\]\.lag1R$/, domain: CORR },
    { path: /^\.pass1\.streamResults\[\]\.(lag1Z|runsZ)$/, domain: FINITE },
    { path: /^\.pass1\.streamResults\[\]\.runsP$/, domain: PROB },
    { path: /^\.pass1\.fisherCombined\.statistic$/, domain: NONNEG },
    { path: /^\.pass1\.fisherCombined\.df$/, domain: intIn(0, 2 * PASS1_STREAMS, 'Fisher df = 2 × streams') },
    { path: /^\.pass1\.fisherCombined\.pValue$/, domain: PROB },
    { path: /^\.pass1\.fisherCombined\.analyticalReference$/, domain: RTP },
    { path: /^\.pass1\.simulatedRTP$/, domain: RTP },
    { path: /^\.pass1\.(serialIndependenceFails|streamsFlaggedSerial)$/, domain: intIn(0, PASS1_STREAMS, 'streams') },
    { path: /^\.pass1\.bonferroni\.(alphaFamily|alphaPerStream)$/, domain: PROB },
    { path: /^\.pass1\.bonferroni\.zCriticalTwoSided$/, domain: NONNEG },
    { path: /^\.pass1\.lag1Autocorrelation$/, domain: CORR },
    { path: /^\.pass1\.runsTest\.z$/, domain: FINITE },
    { path: /^\.pass1\.runsTest\.pValue$/, domain: PROB },
    { path: /^\.pass1\.convergence\[\]\.rounds$/, domain: PER_STREAM },
    { path: /^\.pass1\.convergence\[\]\.rtp$/, domain: RTP },
    { path: /^\.pass2\.(totalSeeds|flaggedSeeds)$/, domain: intIn(0, EXPECTED_EPOCHS, 'revealed casino seeds') },
    { path: /^\.pass2\.noncesPerSeed$/, domain: intIn(0, PASS2_NONCES, 'Pass-2 nonces per seed') },
    { path: /^\.pass2\.cherryPickBinomial$/, domain: PROB },
    { path: /^\.pass2\.perSeed\[\]\.(earlyAvgReturn|extendedAvgReturn)$/, domain: realIn(0, 8, 'average gross return per hand') },
    { path: /^\.pass2\.perSeed\[\]\.extendedVar$/, domain: realIn(0, 64, 'variance of a gross return in [0, 8]') },
    { path: /^\.pass2\.perSeed\[\]\.z$/, domain: FINITE },
    // Test C (src/cherry-pick.ts, profile BLACKJACK-21) — added 2026-09-24.
    { path: /^\.pass2\.testC\.windowSize$/, domain: intIn(1, PASS2_NONCES, 'nonces per window') },
    { path: /^\.pass2\.testC\.windowsPerSeed$/, domain: intIn(1, PASS2_NONCES, 'windows per seed') },
    { path: /^\.pass2\.testC\.flagRank$/, domain: intIn(0, PASS2_NONCES, 'largest flagging rank') },
    { path: /^\.pass2\.testC\.(alpha|nullFlagProbability)$/, domain: PROB },
    { path: /^\.pass2\.testC\.flags$/, domain: intIn(0, EXPECTED_EPOCHS, 'revealed casino seeds') },
    { path: /^\.pass2\.testC\.failAbove$/, domain: NONNEG },
    { path: /^\.pass2\.perSeed\[\]\.windowReturnHalf\[\]$/, domain: intIn(0, 16 * 50, 'half-stake gross return of 50 hands, at most 8 units a hand') },
    { path: /^\.pass2\.perSeed\[\]\.testC_rank$/, domain: intIn(0, PASS2_NONCES, 'null windows at or below the served one') },
    { path: /^\.pass2\.perSeed\[\]\.firstCardRanks\.(2|3|4|5|6|7|8|9|10|J|Q|K|A)$/, domain: intIn(0, PASS2_NONCES, 'nonces of one seed') },
  ],
};

export const collapse = (p: string): string => p.replace(/\[\d+\]/g, '[]');

export function numericLeaves(value: unknown, prefix = '', out: Array<[string, number]> = []): Array<[string, number]> {
  if (typeof value === 'number') { out.push([prefix, value]); return out; }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) value.forEach((v, i) => numericLeaves(v, `${prefix}[${i}]`, out));
    else for (const k of Object.keys(value)) numericLeaves((value as Record<string, unknown>)[k], `${prefix}.${k}`, out);
  }
  return out;
}

export function validateDomains(file: string, parsed: unknown): { checked: number; violations: string[]; uncovered: string[] } {
  const rules = DOMAIN_RULES[file] ?? [];
  const violations: string[] = [], uncovered = new Set<string>();
  let checked = 0;
  for (const [p, v] of numericLeaves(parsed)) {
    checked++;
    const c = collapse(p);
    const rule = rules.find(r => r.path.test(c));
    if (!rule) { uncovered.add(c); continue; }
    if (!rule.domain.ok(v)) violations.push(`${file} ${p} = ${v} is not ${rule.domain.label}`);
  }
  return { checked, violations, uncovered: [...uncovered] };
}
