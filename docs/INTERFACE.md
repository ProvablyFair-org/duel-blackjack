# Module interface the audit package expects (written by the auditor, not from the casino)

Write `rng.ts` (TypeScript, strict, Node `crypto` only, no dependencies) exporting exactly these names.
Semantics come from ALGORITHM.md; this file only fixes names, types and the package's own conventions.
Cards are strings: rank then suit, rank in 2..10,J,Q,K,A and suit in D,H,S,C (e.g. "10S", "AH").
`cursor` = the card counter k of the spec (0 for the first card of the round).

```ts
export interface Card { rank: string; suit: string }   // declare it in rng.ts (the package keeps an identical one in src/types.ts)

export const CARDS: string[];          // the 52 cards in index order 0..51, per the spec's table
export const DECK_RANGE: number;       // 52
export const MAX_FAIR: number;         // rejection limit for a draw over 52 (values >= this rejected)
export const CHUNKS_PER_HASH: number;  // 4-byte chunks available in one digest (8)

export function hmacSHA256(serverSeedHex: string, message: string): Buffer;         // key per the spec
export function hmacSHA256WithKey(keyBuffer: Buffer, message: string): Buffer;     // key already decoded
// One card from one digest, applying the spec's draw rule (and rejection rule, as the spec states it).
// Throw if the digest yields no accepted value.
export function generateCardFromHash(hash: Buffer): string;
export function generateCardIndexFromHash(hash: Buffer): number;                  // same draw, index 0..51
// Same draw, also reporting how many chunks were rejected before acceptance; card null if none accepted.
export function drawWithCensus(hash: Buffer): { card: string | null; rejected: number };
export function getCard(serverSeed: string, clientSeed: string, nonce: number, cursor: number): string;
export function getCardWithKey(keyBuffer: Buffer, clientSeed: string, nonce: number, cursor: number): string;
// Cards for cursors 0..count-1, in cursor order.
export function getDeck(serverSeed: string, clientSeed: string, nonce: number, count?: number): string[];
// The commitment hash of a server seed, as lowercase hex (per the spec's commitment section).
export function hashServerSeed(serverSeed: string): string;

// Plain card helpers (standard blackjack rules):
export function cardRank(card: string): string;                   // "10S" -> "10"
export function cardSuit(card: string): string;                   // "10S" -> "S"
export function cardColor(card: string): 'red' | 'black';         // D/H red, S/C black
export function rankValue(rank: string): number;                  // A = 11, J/Q/K = 10, else the number
export function parseCard(card: string): Card;
export function handValue(cards: string[]): { hard: number; soft: number; best: number; isSoft: boolean };
//   hard = aces as 1; soft = one ace as 11 if that does not bust (else = hard); best = the higher non-busting total
//   (or hard if both bust); isSoft = best counts an ace as 11.
export function isBlackjack(cards: string[]): boolean;            // exactly two cards totalling 21
export function isBust(cards: string[]): boolean;                 // hard total > 21

// Cursor positions of the initial deal, per the spec's deal order.
export const DEAL_ORDER: { readonly PLAYER_1: number; readonly DEALER_UP: number; readonly PLAYER_2: number; readonly DEALER_HOLE: number; readonly FIRST_ACTION: number };
```
Round play (actions, splits, payouts) is NOT part of this module (the package replays rounds itself); implement only the above.
