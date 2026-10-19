/**
 * Duel Blackjack — Optimal-Play RTP Engine
 *
 * Independent recursive infinite-deck EV solver. Computes the theoretical RTP
 * of optimal basic strategy without referencing any casino-supplied figure or
 * external reference (the two dated Wizard of Odds pages cited in evidence/E14, E15
 * are used only to cross-validate the ENGINE under their own rules, Step 16 —
 * never as an input).
 *
 * Game rules (all confirmed from the dataset):
 *   - Infinite deck (each draw independent, P(rank) below)
 *   - Dealer stands on soft 17 (S17) — verify.ts Step 19
 *   - Blackjack pays 3:2 (1.5× profit) — verify.ts Step 20
 *   - Player can double on any two cards — verify.ts Step 21
 *   - Player can split on matching rank — verify.ts Step 22
 *   - Double after split allowed (DAS) — verify.ts Step 23
 *   - One card on split aces, no further action
 *   - No re-splitting (0 re-splits observed in 269 splits — Step 23)
 *   - Dealer peeks for blackjack on Ace/10 upcards
 *   - No surrender — Step 25 / available_actions
 *
 * Card probabilities (infinite deck, suit-agnostic):
 *   2..9, A: 1/13 each      (4 suits, 1 rank)
 *   T (10/J/Q/K):  4/13     (4 suits × 4 ranks all valued 10)
 *
 * Output: optimal-play RTP across all initial (P1, P2, dealerUp) triples.
 *
 * Cross-check (Step 16, profile BLACKJACK-18): the same engine, switched to the rules each of two
 * dated Wizard of Odds pages states (evidence/E14, E15 — both RE-SPLIT, so `ReferenceRules.maxHands`
 * exists for them only), must reproduce the figure printed on the page. Neither page states Duel's
 * rule set (no re-split); the 99.4296% this file quoted
 * as "Wizard of Odds for Duel's exact rule set" until 2026-09-25 was not found on the 48 pages read (E16) and is
 * this engine's own figure (MANIFEST.md, Errata — 25 September 2026).
 */

import { RULES_IN_EFFECT as R } from './config';

// ── Card model ──────────────────────────────────────────────────────────────

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'] as const;
type Rank = typeof RANKS[number];

const P: Record<Rank, number> = {
  '2': 1/13, '3': 1/13, '4': 1/13, '5': 1/13, '6': 1/13,
  '7': 1/13, '8': 1/13, '9': 1/13, 'T': 4/13, 'A': 1/13,
};

const V: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
  '7': 7, '8': 8, '9': 9, 'T': 10, 'A': 11,
};

interface State {
  total: number;
  soft: boolean;
}

function add(s: State, r: Rank): State {
  let total = s.total;
  let soft = s.soft;
  if (r === 'A') {
    if (total + 11 <= 21) { total += 11; soft = true; }
    else { total += 1; }
  } else {
    total += V[r];
    if (total > 21 && soft) { total -= 10; soft = false; }
  }
  return { total, soft };
}

// ── Rule options for the external references ONLY (Step 16) ────────────────
/**
 * Rules that exist in this engine ONLY so it can be switched to the rule set a published external
 * reference states (Step 16, profile BLACKJACK-18) and to flip that reference's unstated rules one
 * at a time (the negative controls). Every field omitted = Duel's declared rule, and with every
 * field omitted the engine runs exactly the code path that produced the published figures (the
 * branches below are taken only when a field differs from Duel's rule).
 */
export interface ReferenceRules {
  /** Max hands a split may produce. Omitted = 2 (one split, no re-split — Duel). Infinity = unlimited. */
  maxHands?: number;
  /** Aces may be re-split (only with maxHands > 2). Omitted = false. */
  resplitAces?: boolean;
  /** Split aces are played out like any hand. Omitted = !RULES.splitAcesOneCard (Duel: one card). */
  playableSplitAces?: boolean;
  /** Up-cards the dealer peeks behind before the player acts. Omitted = 'ace-and-ten' (Duel). */
  dealerPeek?: 'ace-and-ten' | 'ace-only';
  /** A player natural pushes against a dealer natural. Omitted = true (Duel). */
  naturalPushesVsDealerNatural?: boolean;
  /** A two-card 21 on a split hand is paid 3:2 (wins 1.5 unless the dealer holds a natural). Omitted = false (Duel: an ordinary 21). */
  split21At32?: boolean;
  /** Gross return of a natural per unit. Omitted = RULES (Duel: 3:2 → 2.5). */
  naturalGross?: number;
}
interface RefState {
  maxHands: number; resplitAces: boolean; splitAcesOneCard: boolean; peekTen: boolean;
  naturalPushes: boolean; split21At32: boolean; naturalGross: number;
}
const refState = (o: ReferenceRules): RefState => ({
  maxHands: o.maxHands ?? 2,
  resplitAces: o.resplitAces ?? false,
  splitAcesOneCard: o.playableSplitAces === undefined ? R.splitAcesOneCard : !o.playableSplitAces,
  peekTen: (o.dealerPeek ?? 'ace-and-ten') === 'ace-and-ten',
  naturalPushes: o.naturalPushesVsDealerNatural ?? true,
  split21At32: o.split21At32 ?? false,
  naturalGross: o.naturalGross ?? R.naturalGross,
});
/** The rule set the current solve runs under; reset to Duel's by every computeOptimalRTP / computeAverageWager call. */
let REF: RefState = refState({});
/** P(dealer natural) still live AT a player decision: 0 behind a peeked up-card (the natural ended the round first). */
const pDealerBJAtAction = (up: Rank): number =>
  up === 'A' ? 0 : up === 'T' && !REF.peekTen ? P['A'] : 0;

// ── Dealer distribution ─────────────────────────────────────────────────────
// Returns map total → probability. Total 22 means bust.

type S17 = 'hit' | 'stand';

const dealerCache = new Map<string, Map<number, number>>();

function dealerDist(state: State, s17: S17): Map<number, number> {
  const key = `${state.total}-${state.soft}-${s17}`;
  const cached = dealerCache.get(key);
  if (cached) return cached;

  if (state.total > 21) {
    const m = new Map<number, number>([[22, 1]]);
    dealerCache.set(key, m);
    return m;
  }

  const stands =
    state.total >= 18 ||
    (state.total === 17 && (!state.soft || s17 === 'stand'));

  if (stands) {
    const m = new Map<number, number>([[state.total, 1]]);
    dealerCache.set(key, m);
    return m;
  }

  const m = new Map<number, number>();
  for (const r of RANKS) {
    const next = add(state, r);
    const sub = dealerDist(next, s17);
    for (const [t, p] of sub) {
      m.set(t, (m.get(t) || 0) + P[r] * p);
    }
  }
  dealerCache.set(key, m);
  return m;
}

/**
 * Dealer outcome distribution starting from upcard, with peek rule.
 * Returns:
 *   pBJ      — probability dealer has blackjack given this upcard
 *   distNoBJ — distribution of dealer final totals conditional on no BJ
 */
function dealerStartDist(upcard: Rank, s17: S17): { pBJ: number; distNoBJ: Map<number, number> } {
  const afterUp = add({ total: 0, soft: false }, upcard);

  if (upcard !== 'T' && upcard !== 'A') {
    return { pBJ: 0, distNoBJ: dealerDist(afterUp, s17) };
  }

  const pBJ = upcard === 'A' ? P['T'] : P['A'];

  const distNoBJ = new Map<number, number>();
  for (const hole of RANKS) {
    const isBJHole = (upcard === 'A' && hole === 'T') || (upcard === 'T' && hole === 'A');
    if (isBJHole) continue;
    const after2 = add(afterUp, hole);
    const sub = dealerDist(after2, s17);
    const pHoleCond = P[hole] / (1 - pBJ);
    for (const [t, pt] of sub) {
      distNoBJ.set(t, (distNoBJ.get(t) || 0) + pHoleCond * pt);
    }
  }
  return { pBJ, distNoBJ };
}

// ── Player decision EV (conditional on no dealer BJ) ────────────────────────

const standCache = new Map<string, number>();

function standEV(playerTotal: number, dealerUp: Rank, s17: S17): number {
  if (playerTotal > 21) return -1;
  const key = `${playerTotal}-${dealerUp}-${s17}-${REF.peekTen ? 'p' : 'n'}`;
  const cached = standCache.get(key);
  if (cached !== undefined) return cached;

  const { distNoBJ } = dealerStartDist(dealerUp, s17);
  let ev = 0;
  for (const [t, pt] of distNoBJ) {
    if (t === 22) ev += pt * 1;          // dealer bust → win
    else if (playerTotal > t) ev += pt * 1;
    else if (playerTotal < t) ev += pt * -1;
  }
  // External-reference controls only: behind an UN-peeked ten the dealer natural is still live at
  // this decision and beats every non-natural player hand (the full committed stake is lost).
  const pn = pDealerBJAtAction(dealerUp);
  if (pn > 0) ev = -pn + (1 - pn) * ev;
  standCache.set(key, ev);
  return ev;
}

const hitCache = new Map<string, number>();

function hitEV(state: State, dealerUp: Rank, s17: S17): number {
  const key = `${state.total}-${state.soft}-${dealerUp}-${s17}-${REF.peekTen ? 'p' : 'n'}`;
  const cached = hitCache.get(key);
  if (cached !== undefined) return cached;

  let ev = 0;
  for (const r of RANKS) {
    const next = add(state, r);
    if (next.total > 21) {
      ev += P[r] * -1;
    } else {
      const s = standEV(next.total, dealerUp, s17);
      const h = hitEV(next, dealerUp, s17);
      ev += P[r] * Math.max(s, h);
    }
  }
  hitCache.set(key, ev);
  return ev;
}

function doubleEV(state: State, dealerUp: Rank, s17: S17): number {
  let ev = 0;
  for (const r of RANKS) {
    const next = add(state, r);
    const s = next.total > 21 ? -1 : standEV(next.total, dealerUp, s17);
    ev += P[r] * s;
  }
  return 2 * ev;
}

/**
 * EV of one post-split hand starting from a single card of `rank`.
 * - Aces: receive exactly one more card, then stand (no hit/double).
 * - Non-aces: full play (hit/stand/double allowed if `das`).
 * No re-splitting (0 re-splits observed in capture).
 */
function postSplitHandEV(rank: Rank, dealerUp: Rank, s17: S17, das: boolean): number {
  const start: State = add({ total: 0, soft: false }, rank);
  let ev = 0;
  for (const r of RANKS) {
    const next = add(start, r);
    if (REF.split21At32 && next.total === 21) {
      // External-reference control only: a split two-card 21 paid 3:2 like a natural.
      ev += P[r] * 1.5 * (1 - pDealerBJAtAction(dealerUp));
    } else if (rank === 'A' && REF.splitAcesOneCard) {
      // One card only, then stand (RULES.splitAcesOneCard)
      const s = next.total > 21 ? -1 : standEV(next.total, dealerUp, s17);
      ev += P[r] * s;
    } else {
      const s = next.total > 21 ? -1 : standEV(next.total, dealerUp, s17);
      const h = hitEV(next, dealerUp, s17);
      let best = Math.max(s, h);
      if (das) {
        const d = doubleEV(next, dealerUp, s17);
        best = Math.max(best, d);
      }
      ev += P[r] * best;
    }
  }
  return ev;
}

/** Value of one post-split hand GIVEN its second card r (the summand of postSplitHandEV). */
function postSplitHandValue(rank: Rank, r: Rank, dealerUp: Rank, s17: S17, das: boolean): number {
  const next = add(add({ total: 0, soft: false }, rank), r);
  if (REF.split21At32 && next.total === 21) return 1.5 * (1 - pDealerBJAtAction(dealerUp));
  const s = next.total > 21 ? -1 : standEV(next.total, dealerUp, s17);
  if (rank === 'A' && REF.splitAcesOneCard) return s;
  const h = hitEV(next, dealerUp, s17);
  return das ? Math.max(s, h, doubleEV(next, dealerUp, s17)) : Math.max(s, h);
}

/**
 * Split EV. Under Duel's rule (maxHands 2, no re-split) this is exactly 2 × postSplitHandEV, the
 * expression every published figure was computed with. With re-splitting — the external references
 * ONLY (Step 16) — infinite-deck hands are independent given their cards, so the split is a
 * sequential decision over (k hands still waiting for a second card, h hands in play): a drawn card
 * of the split rank may be kept and played, or re-split while h < maxHands, whichever is worth more.
 * (Ported from the ProvablyFair.org HouseBets Blackjack package, src/optimal-play.ts.)
 */
function splitEV(rank: Rank, dealerUp: Rank, s17: S17, das: boolean): number {
  const H = REF.maxHands;
  if (H === 2 || (rank === 'A' && !REF.resplitAces)) return 2 * postSplitHandEV(rank, dealerUp, s17, das);
  const q = P[rank];
  const vp = postSplitHandValue(rank, rank, dealerUp, s17, das);
  let a = 0;
  for (const r of RANKS) if (r !== rank) a += P[r] * postSplitHandValue(rank, r, dealerUp, s17, das);
  const cap = Number.isFinite(H) ? H : 400;
  const memo = new Map<number, number>();
  const Vk = (k: number, h: number): number => {
    if (k === 0) return 0;
    const key = k * 1000 + h;
    const m = memo.get(key); if (m !== undefined) return m;
    const keep = vp + Vk(k - 1, h);
    const choice = h < cap ? Math.max(keep, Vk(k + 1, h + 1)) : keep;
    const v = a + (1 - q) * Vk(k - 1, h) + q * choice;
    memo.set(key, v);
    return v;
  };
  // Evaluate bottom-up in h so the recursion depth stays bounded.
  for (let h = cap; h >= 2; h--) for (let k = 1; k <= h; k++) Vk(k, h);
  return Vk(2, 2);
}

/**
 * Best EV over all available player actions, given (P1, P2, dealerUp).
 * Player does NOT have blackjack here (BJ handled separately at the top level).
 */
function playerOptimalEV(p1: Rank, p2: Rank, dealerUp: Rank, s17: S17, das: boolean): number {
  const state = add(add({ total: 0, soft: false }, p1), p2);

  const s = standEV(state.total, dealerUp, s17);
  const h = hitEV(state, dealerUp, s17);
  const d = doubleEV(state, dealerUp, s17);

  let best = Math.max(s, h, d);

  if (p1 === p2) {
    const sp = splitEV(p1, dealerUp, s17, das);
    best = Math.max(best, sp);
  }
  return best;
}

// ── Top-level RTP ───────────────────────────────────────────────────────────

export interface OptimalPlayResult {
  rtp: number;            // RTP as fraction (0..1+), e.g. 0.99489
  edge: number;           // 1 - rtp
  playerBJFreq: number;   // P(player natural BJ) over all initial 2-card hands
  dealerBJFreq: number;   // P(dealer natural BJ given any starting upcard)
  s17: S17;
  das: boolean;
}

/**
 * Compute optimal-play RTP under the configured rule set.
 *
 * RTP = E[payout / wager] across all (P1, P2, dealerUp) triples, taking
 * the optimal action at each state and accounting for player BJ, dealer
 * peek, and dealer BJ outcomes.
 */
export function computeOptimalRTP(s17: S17 = R.soft17, das: boolean = R.das, ref: ReferenceRules = {}): OptimalPlayResult {
  REF = refState(ref);
  let rtpSum = 0;
  let playerBJProb = 0;

  for (const p1 of RANKS) {
    for (const p2 of RANKS) {
      const playerBJ = (p1 === 'T' && p2 === 'A') || (p1 === 'A' && p2 === 'T');
      if (playerBJ) playerBJProb += P[p1] * P[p2];

      for (const up of RANKS) {
        const pCombo = P[p1] * P[p2] * P[up];

        const upPeeks = up === 'A' || (up === 'T' && REF.peekTen);
        const pDealerBJ = up === 'A' ? P['T'] : up === 'T' ? P['A'] : 0;

        let returnRatio: number; // total returned / wagered

        if (playerBJ && pDealerBJ > 0) {
          // Player BJ vs dealer that may have BJ: push if dealer BJ, else 2.5×
          returnRatio = pDealerBJ * (REF.naturalPushes ? 1 : REF.naturalGross) + (1 - pDealerBJ) * REF.naturalGross;
        } else if (playerBJ) {
          returnRatio = REF.naturalGross;
        } else if (upPeeks) {
          // Dealer might have BJ — if so player loses, else play optimally
          const optEV = playerOptimalEV(p1, p2, up, s17, das);
          returnRatio = pDealerBJ * 0 + (1 - pDealerBJ) * (1 + optEV);
        } else {
          const optEV = playerOptimalEV(p1, p2, up, s17, das);
          returnRatio = 1 + optEV;
        }

        rtpSum += pCombo * returnRatio;
      }
    }
  }

  // Sanity normalization: P(any combo) sums to 1
  const dealerBJProb = 2 * P['T'] * P['A']; // P(dealer 2-card BJ)

  return {
    rtp: rtpSum,
    edge: 1 - rtpSum,
    playerBJFreq: playerBJProb,
    dealerBJFreq: dealerBJProb,
    s17,
    das,
  };
}

/**
 * THE AVERAGE WAGER of the same optimal strategy (profile BLACKJACK-19: state the RTP per initial
 * bet AND per total amount wagered). Walks the identical decision tree computeOptimalRTP solves and
 * counts the stake each (P1, P2, up-card) triple puts at risk under the action the engine chose:
 * 1 for stand/hit (hitting adds no stake), 2 for a double, and for a split 2 × the per-hand stake
 * (1, or 2 where the post-split hand doubles under DAS). A dealer natural at the peek ends the
 * round at stake 1; a player natural stakes 1. Ties between actions (exact floating equality of
 * two EVs) resolve to the smaller stake — none occurs at the rule set solved here (checked by
 * tests/blackjack/FrameworkTests.ts).
 */
export function computeAverageWager(s17: S17 = R.soft17, das: boolean = R.das): { averageWager: number; ties: number } {
  REF = refState({});   // Duel's rules: the average wager is stated for Duel's game only
  let wager = 0, ties = 0;
  const postSplitWager = (rank: Rank, up: Rank): number => {
    if (rank === 'A' && R.splitAcesOneCard) return 1;
    let w = 0;
    const start: State = add({ total: 0, soft: false }, rank);
    for (const r of RANKS) {
      const next = add(start, r);
      const st = next.total > 21 ? -1 : standEV(next.total, up, s17);
      const h = hitEV(next, up, s17);
      const d = das ? doubleEV(next, up, s17) : -Infinity;
      if (d === Math.max(st, h)) ties++;
      w += P[r] * (d > Math.max(st, h) ? 2 : 1);
    }
    return w;
  };
  for (const p1 of RANKS) for (const p2 of RANKS) for (const up of RANKS) {
    const pCombo = P[p1] * P[p2] * P[up];
    const playerBJ = (p1 === 'T' && p2 === 'A') || (p1 === 'A' && p2 === 'T');
    const pDealerBJ = up === 'A' ? P['T'] : up === 'T' ? P['A'] : 0;
    if (playerBJ) { wager += pCombo; continue; }
    const state = add(add({ total: 0, soft: false }, p1), p2);
    const st = standEV(state.total, up, s17), h = hitEV(state, up, s17), d = doubleEV(state, up, s17);
    const sp = p1 === p2 ? splitEV(p1, up, s17, das) : -Infinity;
    const other = Math.max(st, h);
    let w: number;
    if (sp > Math.max(other, d)) w = 2 * postSplitWager(p1, up);
    else if (d > other) w = 2;
    else w = 1;
    if (sp === Math.max(other, d) || d === other) ties++;
    wager += pCombo * (pDealerBJ * 1 + (1 - pDealerBJ) * w);
  }
  return { averageWager: wager, ties };
}

/**
 * Clear all internal caches. Used by tests that vary the rule set.
 */
export function clearCaches(): void {
  dealerCache.clear();
  standCache.clear();
  hitCache.clear();
}

// ── CLI entry point ─────────────────────────────────────────────────────────

if (require.main === module) {
  console.log('Computing optimal-play RTP under S17 + DAS (Duel.com rules)...');
  const t0 = Date.now();
  const result = computeOptimalRTP();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  console.log('');
  console.log('  Rules:           S17, DAS, no surrender, no re-split, infinite deck');
  console.log(`  Optimal RTP:     ${(result.rtp * 100).toFixed(6)}%`);
  console.log(`  House edge:      ${(result.edge * 100).toFixed(6)}%`);
  console.log(`  Player BJ freq:  ${(result.playerBJFreq * 100).toFixed(4)}% (expected 8/169 = ${(8/169 * 100).toFixed(4)}%)`);
  console.log(`  Dealer BJ freq:  ${(result.dealerBJFreq * 100).toFixed(4)}%`);
  console.log(`  Time:            ${elapsed}s`);
  console.log('');
  console.log('  External references (dated Wizard of Odds pages, re-split rules — not Duel\'s): `npm run verify`, Step 16');
}
