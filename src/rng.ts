/**
 * Duel.com Blackjack RNG — HMAC-SHA256 card generation
 *
 * Single canonical implementation. Imported by verify.ts, simulate.ts, and tests.
 * NEVER re-implement card generation elsewhere.
 *
 * Algorithm (from Duel.com fairness page verification code):
 *   1. hash = HMAC-SHA256(hex_decode(serverSeed), clientSeed:nonce:cursor)
 *   2. Read 4-byte chunks as big-endian uint32
 *   3. Rejection sampling: skip if value >= 52 * floor(2^32 / 52)
 *   4. Card index = value % 52
 *   5. Card = CARDS[index]
 *
 * 50 cards pre-generated per hand (cursor 0-49).
 * Infinite deck — each card drawn independently at 1/52.
 */

import * as crypto from 'crypto';
import { Card } from './types';

// ── Card Array (52 cards, index 0-51) ───────────────────────────────────────
// Order: rank ascending (2→A), within rank: D, H, S, C
export const CARDS: string[] = [
  '2D','2H','2S','2C', '3D','3H','3S','3C', '4D','4H','4S','4C',
  '5D','5H','5S','5C', '6D','6H','6S','6C', '7D','7H','7S','7C',
  '8D','8H','8S','8C', '9D','9H','9S','9C', '10D','10H','10S','10C',
  'JD','JH','JS','JC', 'QD','QH','QS','QC', 'KD','KH','KS','KC',
  'AD','AH','AS','AC',
];

// Bias-free maximum: largest multiple of 52 that fits in uint32
const MAX_FAIR = 52 * Math.floor(0x100000000 / 52); // 4,294,967,248

// ── Core Functions ──────────────────────────────────────────────────────────

/** HMAC-SHA256 with hex-decoded key (sync, for speed) */
export function hmacSHA256(serverSeedHex: string, message: string): Buffer {
  const key = Buffer.from(serverSeedHex, 'hex');
  return crypto.createHmac('sha256', key).update(message).digest();
}

/** HMAC-SHA256 with pre-allocated key buffer (simulation hot path) */
export function hmacSHA256WithKey(keyBuffer: Buffer, message: string): Buffer {
  return crypto.createHmac('sha256', keyBuffer).update(message).digest();
}

/** Generate a single card from an HMAC hash via rejection sampling */
export function generateCardFromHash(hash: Buffer): string {
  for (let i = 0; i <= hash.length - 4; i += 4) {
    const value = hash.readUInt32BE(i);
    if (value < MAX_FAIR) {
      return CARDS[value % 52];
    }
  }
  throw new Error('Failed to generate unbiased card from hash — all 8 chunks rejected');
}

/** Get the card index (0-51) from a hash — used for chi-squared testing */
export function generateCardIndexFromHash(hash: Buffer): number {
  for (let i = 0; i <= hash.length - 4; i += 4) {
    const value = hash.readUInt32BE(i);
    if (value < MAX_FAIR) {
      return value % 52;
    }
  }
  throw new Error('Failed to generate unbiased card index from hash');
}

/**
 * Get a single card at a specific cursor position.
 * This is the canonical card generation function.
 */
export function getCard(serverSeed: string, clientSeed: string, nonce: number, cursor: number): string {
  const message = `${clientSeed}:${nonce}:${cursor}`;
  const hash = hmacSHA256(serverSeed, message);
  return generateCardFromHash(hash);
}

/**
 * Get a card using a pre-allocated key buffer (simulation hot path).
 */
export function getCardWithKey(keyBuffer: Buffer, clientSeed: string, nonce: number, cursor: number): string {
  const message = `${clientSeed}:${nonce}:${cursor}`;
  const hash = hmacSHA256WithKey(keyBuffer, message);
  return generateCardFromHash(hash);
}

/**
 * Generate the full 50-card deck for a hand.
 */
export function getDeck(serverSeed: string, clientSeed: string, nonce: number, count: number = 50): string[] {
  const cards: string[] = [];
  for (let cursor = 0; cursor < count; cursor++) {
    cards.push(getCard(serverSeed, clientSeed, nonce, cursor));
  }
  return cards;
}

/** SHA-256 hash of server seed (for commitment verification) */
/** Duel Blackjack uses SHA-256 of hex-decoded bytes, not UTF-8 string */
export function hashServerSeed(serverSeed: string): string {
  return crypto.createHash('sha256').update(Buffer.from(serverSeed, 'hex')).digest('hex');
}

// ── Card Utility Functions ──────────────────────────────────────────────────

/** Extract rank from card string: "10S" → "10", "AH" → "A" */
export function cardRank(card: string): string {
  return card.slice(0, -1);
}

/** Extract suit from card string: "10S" → "S", "AH" → "H" */
export function cardSuit(card: string): string {
  return card.slice(-1);
}

/** Card color: D/H = red, S/C = black */
export function cardColor(card: string): 'red' | 'black' {
  const suit = cardSuit(card);
  return (suit === 'D' || suit === 'H') ? 'red' : 'black';
}

/** Numeric value of a card rank: A=11, face=10, number=number */
export function rankValue(rank: string): number {
  if (rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(rank)) return 10;
  return parseInt(rank);
}

/** Parse a card string to a Card object */
export function parseCard(card: string): Card {
  return { rank: cardRank(card), suit: cardSuit(card) };
}

/** Compute hand value with ace reduction */
export function handValue(cards: string[]): { hard: number; soft: number; best: number; isSoft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = cardRank(card);
    if (rank === 'A') { aces++; total += 1; }
    else total += rankValue(rank);
  }
  const hard = total;
  let soft = total;
  if (aces > 0 && total + 10 <= 21) soft = total + 10;
  const best = soft <= 21 ? soft : hard;
  return { hard, soft, best, isSoft: soft !== hard && soft <= 21 };
}

/** Is this a natural blackjack (two-card 21)? */
export function isBlackjack(cards: string[]): boolean {
  if (cards.length !== 2) return false;
  return handValue(cards).best === 21;
}

/** Is this hand busted? */
export function isBust(cards: string[]): boolean {
  return handValue(cards).best > 21;
}

/**
 * Deal order mapping (confirmed from dataset — alternating P/D):
 *   cursor 0 → Player card 1
 *   cursor 1 → Dealer upcard
 *   cursor 2 → Player card 2
 *   cursor 3 → Dealer hole card
 *   cursor 4+ → hits, splits, doubles in sequence
 */
export const DEAL_ORDER = {
  PLAYER_1: 0,
  DEALER_UP: 1,
  PLAYER_2: 2,
  DEALER_HOLE: 3,
  FIRST_ACTION: 4,
} as const;
