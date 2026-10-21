/**
 * PROVENANCE (header added on integration, 20 Oct 2026; everything below this comment is the
 * clean-room module byte for byte).
 *
 * This module was REBUILT FROM A WRITTEN SPECIFICATION, not ported from Duel's code:
 *   spec      docs/ALGORITHM.md, a copy of games/blackjack/ALGORITHM.md in the ProvablyFair.org audit
 *             framework (pf-audit, not yet committed there on 20 Oct 2026; SHA-256 ac7a8517…bb535). Written
 *             from Duel's public pages, the standard provably-fair construction and the 6,000 live
 *             rounds, without opening Duel's code (its §8 lists every file read).
 *   rebuild   written by an implementer who read ONLY that spec and a module-interface file, and
 *             never opened Duel's code, its Verify-tab file, or this package's earlier src/rng.ts.
 *   self-test tests/blackjack/RngSpecTests.ts (the spec's §5 vectors and properties).
 *
 * Duel's published Verify-tab code (evidence/verify-tab/duel-verify-tab-blackjack-2026-09-25.js, E17)
 * is NOT the source of this module. It is run byte for byte as a SECOND CHECK, by Step 38 and the
 * unit tests (src/operator-verifier.ts), next to the ProvablyFair.org docs-site and live-site verifiers.
 *
 * Three-way agreement measured on integration (20 Oct 2026, the 6,000-round capture, rounds replayed
 * from their recorded actions): this module vs the live rounds, every served card 33,194/33,194
 * (6,000/6,000 rounds, splits included), hand values 6,269/6,269, commitments 6,000/6,000; vs Duel's
 * Verify-tab code 300,000/300,000 cursors (0-49 of every round) and 7/7 fixed hashes (rejection and
 * all-rejected throw); vs the provablyfair.org live verifier 144,000/144,000 cursors (0-23).
 * Step 38 re-measures the last two on every run.
 */
// Clean-room card derivation for Duel.com Blackjack, written from ALGORITHM.md
// (the spec) and INTERFACE.md (the export list) only.
import { createHash, createHmac } from 'crypto';

export interface Card { rank: string; suit: string }

// §2 Step 3: ranks in ascending order, suits in the order D, H, S, C.
const RANKS: readonly string[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS: readonly string[] = ['D', 'H', 'S', 'C'];

// §2 Step 3: index i is rank RANKS[i div 4] of suit SUITS[i mod 4] (rank-major).
export const CARDS: string[] = Array.from({ length: 52 }, (_, i) => RANKS[Math.floor(i / 4)] + SUITS[i % 4]);

// §2 Step 2: a draw is a value in 0..51.
export const DECK_RANGE: number = 52;

// §2 Step 2: largest multiple of 52 that fits in 2^32; values at or above it are rejected.
export const MAX_FAIR: number = Math.floor(2 ** 32 / DECK_RANGE) * DECK_RANGE; // 4294967248

// §2 Step 2: the rejection loop walks byte offsets 0, 4, ..., 28 of the 32-byte digest.
export const CHUNKS_PER_HASH: number = 8;

// §2 Step 4: cursor k of each card in the initial deal; later cards start at 4.
export const DEAL_ORDER = Object.freeze({
  PLAYER_1: 0,
  DEALER_UP: 1,
  PLAYER_2: 2,
  DEALER_HOLE: 3,
  FIRST_ACTION: 4,
} as const);

// §1.1: the server seed is 64 hex characters (32 bytes). Buffer.from(..., 'hex')
// silently drops anything that is not hex, so the input is checked first.
function decodeServerSeed(serverSeedHex: string): Buffer {
  if (typeof serverSeedHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(serverSeedHex)) {
    throw new Error('serverSeed must be 64 hexadecimal characters');
  }
  return Buffer.from(serverSeedHex, 'hex');
}

// §2 Step 1: decimal() is plain base 10 with no padding or sign, so only
// non-negative safe integers are accepted for nonce and cursor.
function decimal(n: number, name: string): string {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return String(n);
}

// §2 Step 1: message = UTF-8(clientSeed + ":" + nonce + ":" + k).
function cardMessage(clientSeed: string, nonce: number, cursor: number): string {
  return `${clientSeed}:${decimal(nonce, 'nonce')}:${decimal(cursor, 'cursor')}`;
}

// §2 Step 1: HMAC-SHA256 with the hex-decoded server seed as key.
export function hmacSHA256(serverSeedHex: string, message: string): Buffer {
  return hmacSHA256WithKey(decodeServerSeed(serverSeedHex), message);
}

// §2 Step 1 with the 32-byte key already decoded; the message is encoded as UTF-8 (§6 O6).
export function hmacSHA256WithKey(keyBuffer: Buffer, message: string): Buffer {
  return createHmac('sha256', keyBuffer).update(Buffer.from(message, 'utf8')).digest();
}

// §2 Step 2: read 4-byte big-endian chunks at offsets 0, 4, ..., 28; the first
// chunk below MAX_FAIR gives the index (value mod 52). Reports how many chunks
// were rejected; index is null when every chunk was rejected (§6 O1).
function drawIndex(hash: Buffer): { index: number | null; rejected: number } {
  if (!Buffer.isBuffer(hash) || hash.length < CHUNKS_PER_HASH * 4) {
    throw new Error(`hash must be a Buffer of at least ${CHUNKS_PER_HASH * 4} bytes`);
  }
  let rejected = 0;
  for (let c = 0; c < CHUNKS_PER_HASH; c++) {
    const v = hash.readUInt32BE(c * 4);
    if (v < MAX_FAIR) return { index: v % DECK_RANGE, rejected };
    rejected++;
  }
  return { index: null, rejected };
}

// §2 Steps 2-3, with the rejection rule; throws if all 8 chunks are rejected (§6 O1 leaves that case open).
export function generateCardIndexFromHash(hash: Buffer): number {
  const { index } = drawIndex(hash);
  if (index === null) throw new Error('no 4-byte chunk of the digest is below MAX_FAIR');
  return index;
}

// §2 Steps 2-3: index to card string.
export function generateCardFromHash(hash: Buffer): string {
  return CARDS[generateCardIndexFromHash(hash)];
}

// §2 Step 2: same draw, plus the count of rejected chunks; card null if none accepted.
export function drawWithCensus(hash: Buffer): { card: string | null; rejected: number } {
  const { index, rejected } = drawIndex(hash);
  return { card: index === null ? null : CARDS[index], rejected };
}

// §2 Steps 1-3: the card at cursor k of round (serverSeed, clientSeed, nonce).
export function getCard(serverSeed: string, clientSeed: string, nonce: number, cursor: number): string {
  return getCardWithKey(decodeServerSeed(serverSeed), clientSeed, nonce, cursor);
}

// §2 Steps 1-3 with the key already decoded.
export function getCardWithKey(keyBuffer: Buffer, clientSeed: string, nonce: number, cursor: number): string {
  return generateCardFromHash(hmacSHA256WithKey(keyBuffer, cardMessage(clientSeed, nonce, cursor)));
}

// §2 Steps 1-4: cards for cursors 0..count-1. The spec gives no default length;
// 52 is used when count is omitted.
export function getDeck(serverSeed: string, clientSeed: string, nonce: number, count: number = DECK_RANGE): string[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('count must be a non-negative integer');
  const key = decodeServerSeed(serverSeed);
  const out: string[] = [];
  for (let k = 0; k < count; k++) out.push(getCardWithKey(key, clientSeed, nonce, k));
  return out;
}

// §1.2: commitment = lowercase hex of SHA-256 over the 32 decoded seed bytes (not the ASCII text).
export function hashServerSeed(serverSeed: string): string {
  return createHash('sha256').update(decodeServerSeed(serverSeed)).digest('hex');
}

// ---- Plain card helpers (INTERFACE.md; hand totals per §2 Step 5) ----

export function parseCard(card: string): Card {
  if (typeof card !== 'string' || card.length < 2) throw new Error(`invalid card: ${String(card)}`);
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  if (!RANKS.includes(rank) || !SUITS.includes(suit)) throw new Error(`invalid card: ${card}`);
  return { rank, suit };
}

export function cardRank(card: string): string {
  return parseCard(card).rank;
}

export function cardSuit(card: string): string {
  return parseCard(card).suit;
}

// §3.2 Perfect Pairs colours: diamonds and hearts red, spades and clubs black.
export function cardColor(card: string): 'red' | 'black' {
  const s = cardSuit(card);
  return s === 'D' || s === 'H' ? 'red' : 'black';
}

// §2 Step 5: 2-10 face value, J/Q/K 10, A 11.
export function rankValue(rank: string): number {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  if (!RANKS.includes(rank)) throw new Error(`invalid rank: ${rank}`);
  return Number(rank);
}

// §2 Step 5: count every Ace as 1 for the hard total; a soft total counts one
// Ace as 11 when that does not exceed 21. This equals the spec's "count A as
// 11, subtract 10 per Ace while over 21".
export function handValue(cards: string[]): { hard: number; soft: number; best: number; isSoft: boolean } {
  let hard = 0;
  let aces = 0;
  for (const c of cards) {
    const r = cardRank(c);
    if (r === 'A') { aces++; hard += 1; } else { hard += rankValue(r); }
  }
  const soft = aces > 0 && hard + 10 <= 21 ? hard + 10 : hard;
  const best = soft <= 21 ? soft : hard;
  const isSoft = soft !== hard && best === soft;
  return { hard, soft, best, isSoft };
}

// §3.1: a natural is a two-card 21 (the "unsplit hand" condition is the caller's to apply).
export function isBlackjack(cards: string[]): boolean {
  return cards.length === 2 && handValue(cards).best === 21;
}

// §2 Step 5: bust = total over 21 even with every Ace at 1.
export function isBust(cards: string[]): boolean {
  return handValue(cards).hard > 21;
}
