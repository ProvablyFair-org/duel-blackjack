/**
 * ONE SIMULATED HAND under the declared strategy (src/strategy.ts) and the declared rules
 * (src/config.ts RULES). Moved out of src/simulate.ts on 2026-09-24, unchanged, so verify Step 18 can
 * REPLAY Pass 2 from the revealed seeds with the same code the simulator ran (simulate.ts starts a
 * run when it is imported, so it cannot be imported by verify).
 */
import { getCardWithKey, handValue, isBlackjack, cardRank } from './rng';
import { getOptimalAction, shouldDealerHit } from './strategy';
import { RULES_IN_EFFECT } from './config';

// Confirmed from dataset (verify.ts Step 19 — 0 hits, 75 stands on dealer soft 17)
export const SOFT17_RULE: 'stand' | 'hit' = RULES_IN_EFFECT.soft17;   // src/config.ts RULES
// Double-after-split allowed (verify.ts Step 23 — 109 DAS observed in 269 splits)
export const DAS_ALLOWED = RULES_IN_EFFECT.das;                          // src/config.ts RULES

// ── Simulate one blackjack hand ──────────────────────────────────────────────

export interface HandResult {
  playerReturn: number;    // total returned across all sub-hands (incl. wager)
  wager: number;           // total wagered (1 normal, 2 doubled, 2 split, 4 split+double, etc.)
  outcome: 'win' | 'lose' | 'push' | 'blackjack' | 'bust'; // outcome of the first sub-hand (for tagging)
}

interface PlayerHand {
  cards: string[];
  fromSplitAces: boolean;  // one-card-only rule
  doubled: boolean;
}

export function simulateHand(keyBuffer: Buffer, clientSeed: string, nonce: number): HandResult {
  let cursor = 0;
  function draw(): string { return getCardWithKey(keyBuffer, clientSeed, nonce, cursor++); }

  // Initial deal: P1, D1, P2, D2
  const p1 = draw();
  const d1 = draw();
  const p2 = draw();
  const d2 = draw();

  const dealerCards = [d1, d2];

  // Naturals (peek rule: dealer checks for BJ on 10/A upcard)
  const playerBJ = isBlackjack([p1, p2]);
  const dealerBJ = isBlackjack(dealerCards);

  if (playerBJ && dealerBJ) return { playerReturn: 1, wager: 1, outcome: 'push' };
  if (playerBJ)             return { playerReturn: RULES_IN_EFFECT.naturalGross, wager: 1, outcome: 'blackjack' };
  if (dealerBJ)             return { playerReturn: 0, wager: 1, outcome: 'lose' };

  // Build hand list, possibly splitting once (no re-split — matches dataset)
  let hands: PlayerHand[] = [{ cards: [p1, p2], fromSplitAces: false, doubled: false }];
  let totalWager = 1;

  // Check for split on initial pair (matching rank only)
  if (cardRank(p1) === cardRank(p2)) {
    const action = getOptimalAction([p1, p2], d1, /*canSplit=*/true, /*canDouble=*/true);
    if (action === 'P') {
      const isAces = cardRank(p1) === 'A' && RULES_IN_EFFECT.splitAcesOneCard;
      const h1: PlayerHand = { cards: [p1, draw()], fromSplitAces: isAces, doubled: false };
      const h2: PlayerHand = { cards: [p2, draw()], fromSplitAces: isAces, doubled: false };
      hands = [h1, h2];
      totalWager = 2;
    }
  }

  // Play each hand
  for (const h of hands) {
    if (h.fromSplitAces) continue; // one card only, already drawn

    while (true) {
      const hv = handValue(h.cards);
      if (hv.best >= 21) break;

      const canDouble = h.cards.length === 2 && (hands.length === 1 || DAS_ALLOWED);
      const action = getOptimalAction(h.cards, d1, /*canSplit=*/false, canDouble);

      if (action === 'H') {
        h.cards.push(draw());
      } else if (action === 'D') {
        h.cards.push(draw());
        h.doubled = true;
        totalWager += 1; // additional wager equal to original
        break;
      } else if (action === 'Ds') {
        // Double if allowed, else stand
        if (canDouble) {
          h.cards.push(draw());
          h.doubled = true;
          totalWager += 1;
        }
        break;
      } else {
        break; // stand
      }
    }
  }

  // Dealer plays unless every player hand is bust
  const allBust = hands.every(h => handValue(h.cards).best > 21);
  if (!allBust) {
    while (shouldDealerHit(dealerCards, SOFT17_RULE)) {
      dealerCards.push(draw());
    }
  }
  const dealerHV = handValue(dealerCards);

  // Resolve each hand independently
  let totalReturn = 0;
  let firstOutcome: HandResult['outcome'] = 'push';
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i];
    const hv = handValue(h.cards);
    const handWager = h.doubled ? 2 : 1;
    let ret = 0;
    let outcome: HandResult['outcome'] = 'push';

    if (hv.best > 21) {
      outcome = 'bust';
      ret = 0;
    } else if (dealerHV.best > 21) {
      outcome = 'win';
      ret = 2 * handWager;
    } else if (hv.best > dealerHV.best) {
      outcome = 'win';
      ret = 2 * handWager;
    } else if (hv.best === dealerHV.best) {
      outcome = 'push';
      ret = 1 * handWager;
    } else {
      outcome = 'lose';
      ret = 0;
    }

    totalReturn += ret;
    if (i === 0) firstOutcome = outcome;
  }

  return { playerReturn: totalReturn, wager: totalWager, outcome: firstOutcome };
}

