/**
 * SIDE-BET EDGES BY EXACT ENUMERATION (profile BLACKJACK-19: "both side-bet edges by exact
 * enumeration, never simulated").
 *
 * Under the declared infinite deck every card is an independent uniform draw over the 52-card
 * constant, so Perfect Pairs is decided by the 52² ordered (P1, P2) pairs and 21+3 by the 52³ ordered
 * (P1, P2, up-card) triples. Both are enumerated in full through the SAME classifiers the suite
 * scores the capture with (src/sidebets.ts), and each paytable entry is taken from src/config.ts as
 * an exact rational, so the expected gross return per unit stake is an exact fraction — no float
 * enters it. Edge = 1 − expected return.
 */
import { CARDS } from './rng';
import { classifyPerfectPairs, classifyTwentyOnePlus3 } from './sidebets';
import { PP_PAYTABLE, T3_PAYTABLE, PP_KEY, T3_KEY } from './config';
import { toRational } from './money';

export interface ExactEdge {
  /** Category → number of ordered deals producing it. */
  counts: Record<string, number>;
  outcomes: number;
  /** Expected gross return per unit stake, exact: num / den. */
  returnNum: bigint;
  returnDen: bigint;
  /** Edge = 1 − return, exact: num / den (negative = player-favourable). */
  edgeNum: bigint;
  edgeDen: bigint;
  edge: number;
}

function finish(counts: Record<string, number>, outcomes: number, table: Record<string, string>, keys: Record<string, string>): ExactEdge {
  let den = 1n;
  const rs = Object.entries(counts).map(([cat, n]) => ({ n: BigInt(n), r: toRational(table[keys[cat]])! }));
  for (const x of rs) if (den % x.r.den !== 0n) den *= x.r.den;
  let num = 0n;
  for (const x of rs) num += x.n * x.r.num * (den / x.r.den);
  const returnDen = den * BigInt(outcomes);
  const edgeNum = returnDen - num;
  return { counts, outcomes, returnNum: num, returnDen, edgeNum, edgeDen: returnDen, edge: Number(edgeNum) / Number(returnDen) };
}

export function perfectPairsExact(): ExactEdge {
  const counts: Record<string, number> = {};
  for (const a of CARDS) for (const b of CARDS) {
    const c = classifyPerfectPairs(a, b);
    if (c) counts[c] = (counts[c] ?? 0) + 1;
  }
  return finish(counts, 52 ** 2, PP_PAYTABLE, PP_KEY);
}

export function twentyOnePlus3Exact(): ExactEdge {
  const counts: Record<string, number> = {};
  for (const a of CARDS) for (const b of CARDS) for (const u of CARDS) {
    const c = classifyTwentyOnePlus3(a, b, u);
    if (c) counts[c] = (counts[c] ?? 0) + 1;
  }
  return finish(counts, 52 ** 3, T3_PAYTABLE, T3_KEY);
}
