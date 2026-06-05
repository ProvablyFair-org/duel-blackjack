/**
 * Side Bet Evaluator — Perfect Pairs + 21+3
 *
 * Classifies card combinations and returns the correct multiplier
 * from the config API. Single canonical implementation.
 *
 * Config multipliers (from /api/v2/blackjack/config):
 *   Perfect Pairs: perfect_pair=27, colored_pair=11, mixed_pair=7
 *   21+3: suited_trips=121.2307692, straight_flush=53, three_kind=32, straight=12, flush=5
 */

import { cardRank, cardSuit, cardColor, rankValue } from './rng';
import { PerfectPairsResult, TwentyOnePlus3Result, BlackjackConfig } from './types';

// ── Perfect Pairs ───────────────────────────────────────────────────────────

/**
 * Classify a Perfect Pairs result from two player cards.
 * - Perfect Pair: same rank + same suit
 * - Colored Pair: same rank + same color + different suit
 * - Mixed Pair: same rank + different color
 * - null: no pair (different rank)
 */
export function classifyPerfectPairs(card1: string, card2: string): PerfectPairsResult {
  const r1 = cardRank(card1);
  const r2 = cardRank(card2);

  if (r1 !== r2) return null;

  const s1 = cardSuit(card1);
  const s2 = cardSuit(card2);

  if (s1 === s2) return 'perfect_pair';

  const c1 = cardColor(card1);
  const c2 = cardColor(card2);

  if (c1 === c2) return 'colored_pair';

  return 'mixed_pair';
}

/**
 * Get the Perfect Pairs multiplier from the config.
 * Returns 0 if no pair.
 */
export function getPPMultiplier(result: PerfectPairsResult, config: BlackjackConfig): number {
  if (!result) return 0;
  const pp = config.multipliers.side_perfect_pairs;
  switch (result) {
    case 'perfect_pair': return pp.bj_perfect_pair;
    case 'colored_pair': return pp.bj_colored_pair;
    case 'mixed_pair': return pp.bj_mixed_pair;
  }
}

// ── 21+3 ────────────────────────────────────────────────────────────────────

// Rank order for straight detection: A can be low (A,2,3) or high (Q,K,A)
const RANK_ORDER: Record<string, number> = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13,
};
const ACE_HIGH = 14;

/**
 * Check if three ranks form a straight (consecutive).
 * Handles ace-low (A,2,3) and ace-high (Q,K,A).
 */
function isStraight(r1: string, r2: string, r3: string): boolean {
  const values = [RANK_ORDER[r1], RANK_ORDER[r2], RANK_ORDER[r3]];
  values.sort((a, b) => a - b);

  // Normal consecutive
  if (values[2] - values[1] === 1 && values[1] - values[0] === 1) return true;

  // Ace-high: Q,K,A
  if (values.includes(1)) {
    const withAceHigh = values.map(v => v === 1 ? ACE_HIGH : v);
    withAceHigh.sort((a, b) => a - b);
    if (withAceHigh[2] - withAceHigh[1] === 1 && withAceHigh[1] - withAceHigh[0] === 1) return true;
  }

  return false;
}

/**
 * Classify a 21+3 result from three cards (P1, P2, D_upcard).
 * Priority order: suited_trips > straight_flush > three_kind > straight > flush
 *
 * - Suited Trips: all same rank AND same suit
 * - Straight Flush: 3 consecutive ranks + all same suit
 * - Three of a Kind: all same rank (different suits)
 * - Straight: 3 consecutive ranks (any suits)
 * - Flush: all same suit (not consecutive, not same rank)
 * - null: no qualifying hand
 */
export function classifyTwentyOnePlus3(card1: string, card2: string, card3: string): TwentyOnePlus3Result {
  const r1 = cardRank(card1), r2 = cardRank(card2), r3 = cardRank(card3);
  const s1 = cardSuit(card1), s2 = cardSuit(card2), s3 = cardSuit(card3);

  const sameRank = r1 === r2 && r2 === r3;
  const sameSuit = s1 === s2 && s2 === s3;
  const straight = isStraight(r1, r2, r3);

  // Priority order
  if (sameRank && sameSuit) return 'suited_trips';
  if (straight && sameSuit) return 'straight_flush';
  if (sameRank) return 'three_kind';
  if (straight) return 'straight';
  if (sameSuit) return 'flush';

  return null;
}

/**
 * Get the 21+3 multiplier from the config.
 * Returns 0 if no qualifying hand.
 */
export function get21Plus3Multiplier(result: TwentyOnePlus3Result, config: BlackjackConfig): number {
  if (!result) return 0;
  const t3 = config.multipliers.side_21_plus_3;
  switch (result) {
    case 'suited_trips': return t3.bj_suited_trips;
    case 'straight_flush': return t3.bj_straight_flush;
    case 'three_kind': return t3.bj_three_kind;
    case 'straight': return t3.bj_straight;
    case 'flush': return t3.bj_flush;
  }
}

// ── Combined Evaluator ──────────────────────────────────────────────────────

/**
 * Evaluate both side bets from the initial deal cards.
 * Player cards: P1 (cursor 0), P2 (cursor 2)
 * Dealer upcard: D_up (cursor 1)
 */
export function evaluateSideBets(
  playerCard1: string,
  playerCard2: string,
  dealerUpcard: string,
  config: BlackjackConfig,
): { pp: { result: PerfectPairsResult; multiplier: number }; t3: { result: TwentyOnePlus3Result; multiplier: number } } {
  const ppResult = classifyPerfectPairs(playerCard1, playerCard2);
  const t3Result = classifyTwentyOnePlus3(playerCard1, playerCard2, dealerUpcard);

  return {
    pp: { result: ppResult, multiplier: getPPMultiplier(ppResult, config) },
    t3: { result: t3Result, multiplier: get21Plus3Multiplier(t3Result, config) },
  };
}

// ── Analytical Zero-Edge Proofs ─────────────────────────────────────────────

/** Compute Perfect Pairs EV under infinite deck (should be exactly 0) */
export function computePPExpectedValue(config: BlackjackConfig): number {
  const pp = config.multipliers.side_perfect_pairs;
  // P(perfect) = 1/52, P(colored) = 1/52, P(mixed) = 2/52
  // EV = sum(P * multiplier) - 1
  return (1/52) * pp.bj_perfect_pair + (1/52) * pp.bj_colored_pair + (2/52) * pp.bj_mixed_pair - 1;
}

/** Compute 21+3 EV under infinite deck (should be ~0) */
export function compute21Plus3ExpectedValue(config: BlackjackConfig): number {
  const t3 = config.multipliers.side_21_plus_3;
  // Probabilities from ordered triplet enumeration (52^3 = 140,608)
  const pSuitedTrips = 1 / 2704;
  const pStraightFlush = 288 / 140608;
  const pThreeKind = 15 / 2704;
  const pStraight = 4320 / 140608;
  const pFlush = 8448 / 140608;

  const grossReturn =
    pSuitedTrips * t3.bj_suited_trips +
    pStraightFlush * t3.bj_straight_flush +
    pThreeKind * t3.bj_three_kind +
    pStraight * t3.bj_straight +
    pFlush * t3.bj_flush;

  return grossReturn - 1;
}
