/**
 * Type definitions for Duel.com Blackjack audit
 */

// ── Card Types ──────────────────────────────────────────────────────────────

export interface Card {
  rank: string;  // '2'-'10', 'J', 'Q', 'K', 'A'
  suit: string;  // 'D', 'H', 'S', 'C'
}

export type Suit = 'D' | 'H' | 'S' | 'C';
export type Color = 'red' | 'black';

export interface HandValue {
  hard: number;
  soft: number;
  best: number;
  isSoft: boolean;
}

// ── Strategy Types ──────────────────────────────────────────────────────────

export type Action = 'H' | 'S' | 'D' | 'Ds' | 'P';
// H=Hit, S=Stand, D=Double(else hit), Ds=Double(else stand), P=Split

// ── Side Bet Types ──────────────────────────────────────────────────────────

export type PerfectPairsResult = 'perfect_pair' | 'colored_pair' | 'mixed_pair' | null;
export type TwentyOnePlus3Result = 'suited_trips' | 'straight_flush' | 'three_kind' | 'straight' | 'flush' | null;

export interface SideBetOutcome {
  perfectPairs: { result: PerfectPairsResult; multiplier: number };
  twentyOnePlus3: { result: TwentyOnePlus3Result; multiplier: number };
}

// ── Config Types ────────────────────────────────────────────────────────────

export interface BlackjackConfig {
  multipliers: {
    side_perfect_pairs: {
      bj_perfect_pair: number;
      bj_colored_pair: number;
      bj_mixed_pair: number;
    };
    side_21_plus_3: {
      bj_suited_trips: number;
      bj_straight_flush: number;
      bj_three_kind: number;
      bj_straight: number;
      bj_flush: number;
    };
  };
}

// ── API Response Types ──────────────────────────────────────────────────────

export interface APICard {
  rank: string;
  suit: string;
  face_down: boolean;
}

export interface APIHand {
  cards: APICard[];
  id: string;
  type: string;   // 'main' or 'split'
  value: number;
  result: string | null;  // 'win', 'lose', 'push', 'bust', 'blackjack', null
  has_doubled: boolean;
}

export interface APISideBetResult {
  amount_placed: string;
  amount_won: string;
  multiplier: number;
  effective_edge: number;
  label: string | null;
}

export interface APIBlackjack {
  player: {
    hands: APIHand[];
    user_id: number;
    has_blackjack: boolean;
    has_split: boolean;
    has_doubled: boolean;
    active_hand_index: number;
  };
  dealer: {
    hands: APIHand[];
    user_id: number;
    has_blackjack: boolean;
    has_split: boolean;
    has_doubled: boolean;
    active_hand_index: number;
  };
  available_actions: string[];
  insurance_available: boolean;
  insurance_taken: boolean;
  insurance_result: string | null;
  insurance_expected_value_has_been_added: boolean;
  side_bet_results: {
    side_21_plus_3: APISideBetResult;
    side_perfect_pairs: APISideBetResult;
  };
}

export interface APIBetResponse {
  id: number;
  nonce: number;
  is_win: boolean | number;
  amount_currency: string;
  amount_coins: string;
  amount_won: string;
  balance_type: number;
  created_at: string;
  status: number;
  blackjack: APIBlackjack;
  server_seed_hashed: string;
  client_seed: string;
  effective_edge: number;
}

// ── Dataset Types ───────────────────────────────────────────────────────────

export interface DatasetBet {
  id: number;
  nonce: number;
  phase: string;
  amount_currency: string;
  amount_won: string;
  effective_edge: number;
  server_seed_hashed: string;
  client_seed: string;
  deal: APIBlackjack;     // State after deal
  final: APIBlackjack;    // State after all actions
  actions: string[];      // Sequence of actions taken: ['hit', 'stand'], ['double'], ['split', 'hit', 'stand', 'stand'], etc.
}

export interface DatasetSeed {
  serverSeedHashed: string;
  serverSeed: string | null;
  clientSeed: string;
  nonces: number[];
  phase: string;
  context: string;
}

export interface Dataset {
  bets: DatasetBet[];
  seeds: DatasetSeed[];
  config: BlackjackConfig;
  capturedAt: string;
  account: string;
}
