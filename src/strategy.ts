/**
 * Basic Strategy Engine — Infinite Deck Optimal Play
 *
 * Total-dependent only (composition-dependent benefit = 0% for infinite deck).
 * Source: Wizard of Odds infinite deck expected returns.
 *
 * Two cells differ from standard 6/8-deck S17 strategy (verified against the
 * recursive infinite-deck EV solver in src/optimal-play.ts):
 *   - Soft 13 (A,2) vs dealer 5: HIT instead of Double (D EV < H EV by ≈0.005)
 *   - Soft 15 (A,4) vs dealer 4: HIT instead of Double (D EV < H EV by ≈0.005)
 *
 * All other cells are identical to standard 6/8-deck S17 basic strategy. In
 * particular, S13 vs 6, S14 vs 5/6, and S15 vs 5/6 remain DOUBLE (D > H by
 * 0.018–0.062 EV per the engine).
 */

import { cardRank, handValue, rankValue } from './rng';
import { Action } from './types';

// ── Dealer upcard normalization ─────────────────────────────────────────────
// Face cards and 10 are all value 10. For strategy lookup: '10' covers J/Q/K.
function normalizeUpcard(upcard: string): string {
  const rank = cardRank(upcard);
  if (['J', 'Q', 'K'].includes(rank)) return '10';
  return rank;
}

// ── Strategy Tables ─────────────────────────────────────────────────────────
// Key: player total (string). Value: map of dealer upcard → action.
// Dealer upcards: '2'-'9', '10', 'A'

const HARD: Record<string, Record<string, Action>> = {};
const SOFT: Record<string, Record<string, Action>> = {};
const PAIRS: Record<string, Record<string, Action>> = {};

const DEALERS = ['2','3','4','5','6','7','8','9','10','A'];

function fill(table: Record<string, Record<string, Action>>, key: string, fn: (d: string) => Action): void {
  table[key] = {};
  for (const d of DEALERS) table[key][d] = fn(d);
}

// Hard totals
for (const t of ['5','6','7','8']) fill(HARD, t, () => 'H');
fill(HARD, '9',  d => ['3','4','5','6'].includes(d) ? 'D' : 'H');
fill(HARD, '10', d => d === '10' || d === 'A' ? 'H' : 'D');
fill(HARD, '11', d => d === 'A' ? 'H' : 'D');
fill(HARD, '12', d => ['4','5','6'].includes(d) ? 'S' : 'H');
for (const t of ['13','14','15','16']) fill(HARD, t, d => ['2','3','4','5','6'].includes(d) ? 'S' : 'H');
for (const t of ['17','18','19','20','21']) fill(HARD, t, () => 'S');

// Soft totals (Ace counted as 11)
// Infinite-deck S17 strategy verified against src/optimal-play.ts engine.
// Two cells differ from standard 6/8-deck: S13v5 and S15v4 become HIT; the
// rest of S13–S17 against dealer 4–6 stays DOUBLE (where allowed).
fill(SOFT, '13', d => d === '6'           ? 'D' : 'H');  // A,2
fill(SOFT, '14', d => ['5','6'].includes(d) ? 'D' : 'H');  // A,3
fill(SOFT, '15', d => ['5','6'].includes(d) ? 'D' : 'H');  // A,4
fill(SOFT, '16', d => ['4','5','6'].includes(d) ? 'D' : 'H');
fill(SOFT, '17', d => ['3','4','5','6'].includes(d) ? 'D' : 'H');
fill(SOFT, '18', d => {
  if (['3','4','5','6'].includes(d)) return 'Ds';
  if (['2','7','8'].includes(d)) return 'S';
  return 'H';
});
fill(SOFT, '19', () => 'S');
fill(SOFT, '20', () => 'S');
fill(SOFT, '21', () => 'S');

// Pairs
fill(PAIRS, 'A',  () => 'P');
fill(PAIRS, '10', () => 'S');
fill(PAIRS, '9',  d => ['7','10','A'].includes(d) ? 'S' : 'P');
fill(PAIRS, '8',  () => 'P');
fill(PAIRS, '7',  d => ['2','3','4','5','6','7'].includes(d) ? 'P' : 'H');
fill(PAIRS, '6',  d => ['2','3','4','5','6'].includes(d) ? 'P' : 'H');
fill(PAIRS, '5',  d => d === '10' || d === 'A' ? 'H' : 'D');  // Never split 5s — treat as hard 10
fill(PAIRS, '4',  d => ['5','6'].includes(d) ? 'P' : 'H');
fill(PAIRS, '3',  d => ['2','3','4','5','6','7'].includes(d) ? 'P' : 'H');
fill(PAIRS, '2',  d => ['2','3','4','5','6','7'].includes(d) ? 'P' : 'H');

// ── Decision Function ───────────────────────────────────────────────────────

/**
 * Get the optimal action for a given player hand and dealer upcard.
 *
 * @param playerCards - Array of card strings (e.g., ['8H', 'JC'])
 * @param dealerUpcard - Dealer's visible card string (e.g., '3D')
 * @param canSplit - Whether split is available (first action on a pair)
 * @param canDouble - Whether double is available
 * @returns The optimal action
 */
export function getOptimalAction(
  playerCards: string[],
  dealerUpcard: string,
  canSplit: boolean = true,
  canDouble: boolean = true,
): Action {
  const dealerKey = normalizeUpcard(dealerUpcard);
  const hv = handValue(playerCards);

  // Check for pair (only on first two cards)
  if (playerCards.length === 2 && canSplit) {
    const r1 = cardRank(playerCards[0]);
    const r2 = cardRank(playerCards[1]);
    // Duel splits on matching RANK (not value) — confirmed from API
    if (r1 === r2) {
      const pairKey = ['J','Q','K'].includes(r1) ? '10' : r1;
      const action = PAIRS[pairKey]?.[dealerKey];
      if (action === 'P') return 'P';
      // If pair table says non-split action, fall through to hard/soft
    }
  }

  // Check soft hand (has usable ace)
  if (hv.isSoft) {
    const softKey = String(hv.soft);
    const action = SOFT[softKey]?.[dealerKey];
    if (action) {
      if (action === 'D' && !canDouble) return 'H';
      if (action === 'Ds' && !canDouble) return 'S';
      return action;
    }
  }

  // Hard hand
  const hardKey = String(hv.best);
  const action = HARD[hardKey]?.[dealerKey];
  if (action) {
    if (action === 'D' && !canDouble) return 'H';
    if (action === 'Ds' && !canDouble) return 'S';
    return action;
  }

  // Fallback (should not reach here for valid hands 4-21)
  return hv.best >= 17 ? 'S' : 'H';
}

/**
 * Should the dealer hit? (Depends on soft 17 rule)
 * S17: stand on all 17s. H17: hit on soft 17.
 */
export function shouldDealerHit(cards: string[], soft17Rule: 'stand' | 'hit'): boolean {
  const hv = handValue(cards);
  if (hv.best < 17) return true;
  if (hv.best === 17 && hv.isSoft && soft17Rule === 'hit') return true;
  return false;
}

// ── Exports for testing ─────────────────────────────────────────────────────
export const STRATEGY_TABLES = { HARD, SOFT, PAIRS };
