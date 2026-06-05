/**
 * Duel Blackjack — Optimal-Play RTP Engine
 *
 * Independent recursive infinite-deck EV solver. Computes the theoretical RTP
 * of optimal basic strategy without referencing any casino-supplied figure or
 * external reference (Wizard of Odds is used only for cross-validation, not
 * input).
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
 * Cross-check: result is compared to Wizard of Odds for Duel's exact rule
 * set (99.4296% for infinite-deck S17 with DAS, no surrender, no re-split)
 * — used only as a sanity check, not as an input.
 */

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
  const key = `${playerTotal}-${dealerUp}-${s17}`;
  const cached = standCache.get(key);
  if (cached !== undefined) return cached;

  const { distNoBJ } = dealerStartDist(dealerUp, s17);
  let ev = 0;
  for (const [t, pt] of distNoBJ) {
    if (t === 22) ev += pt * 1;          // dealer bust → win
    else if (playerTotal > t) ev += pt * 1;
    else if (playerTotal < t) ev += pt * -1;
  }
  standCache.set(key, ev);
  return ev;
}

const hitCache = new Map<string, number>();

function hitEV(state: State, dealerUp: Rank, s17: S17): number {
  const key = `${state.total}-${state.soft}-${dealerUp}-${s17}`;
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
    if (rank === 'A') {
      // One card only, then stand
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

function splitEV(rank: Rank, dealerUp: Rank, s17: S17, das: boolean): number {
  return 2 * postSplitHandEV(rank, dealerUp, s17, das);
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
export function computeOptimalRTP(s17: S17 = 'stand', das: boolean = true): OptimalPlayResult {
  let rtpSum = 0;
  let playerBJProb = 0;

  for (const p1 of RANKS) {
    for (const p2 of RANKS) {
      const playerBJ = (p1 === 'T' && p2 === 'A') || (p1 === 'A' && p2 === 'T');
      if (playerBJ) playerBJProb += P[p1] * P[p2];

      for (const up of RANKS) {
        const pCombo = P[p1] * P[p2] * P[up];

        const upPeeks = up === 'A' || up === 'T';
        const pDealerBJ = up === 'A' ? P['T'] : up === 'T' ? P['A'] : 0;

        let returnRatio: number; // total returned / wagered

        if (playerBJ && upPeeks) {
          // Player BJ vs dealer that may have BJ: push if dealer BJ, else 2.5×
          returnRatio = pDealerBJ * 1 + (1 - pDealerBJ) * 2.5;
        } else if (playerBJ) {
          returnRatio = 2.5;
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
  const result = computeOptimalRTP('stand', true);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  console.log('');
  console.log('  Rules:           S17, DAS, no surrender, no re-split, infinite deck');
  console.log(`  Optimal RTP:     ${(result.rtp * 100).toFixed(6)}%`);
  console.log(`  House edge:      ${(result.edge * 100).toFixed(6)}%`);
  console.log(`  Player BJ freq:  ${(result.playerBJFreq * 100).toFixed(4)}% (expected 8/169 = ${(8/169 * 100).toFixed(4)}%)`);
  console.log(`  Dealer BJ freq:  ${(result.dealerBJFreq * 100).toFixed(4)}%`);
  console.log(`  Time:            ${elapsed}s`);
  console.log('');
  console.log('  Cross-check vs Wizard of Odds (Duel rules: S17, DAS, no surrender, no re-split, infinite deck): 99.4296%');
  console.log(`  Δ from WoO:      ${((result.rtp - 0.994296) * 100).toFixed(4)} pp`);
}
