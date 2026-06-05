/**
 * Steps 5–6: Card recomputation and client seed influence.
 *
 * Step 5 verifies that every visible card in every captured bet — for every
 * bet shape (single hand, doubled hand, split with or without DAS, dealer
 * play-out) — recomputes from the seed via cursors 0..N-1.
 *
 *   Non-split bets: strict ordered check. Cursor 0 = P1, 1 = dealer up,
 *     2 = P2, 3 = dealer hole, then player action cards in order, then
 *     dealer's additional draws.
 *
 *   Split bets: multiset check. The multiset of visible cards (across both
 *     sub-hands and the dealer hand) must equal the multiset of cards
 *     produced by cursors 0..N-1. Proves no cursor reuse and full coverage.
 */

import { getCard } from '../../src/rng';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

function cardStr(c: any): string { return c.rank + c.suit; }

interface CursorCardSequence {
  cards: string[];      // cursor 0 → cards[0], cursor 1 → cards[1], ...
  multisetMode: boolean;// true for split bets (cursor ordering not strictly defined here)
}

/** Build the cursor → card list for a non-split bet, in strict cursor order. */
function buildNonSplitSequence(bet: any): string[] | null {
  const deal = bet.deal?.blackjack;
  const final = bet.final?.blackjack || bet.final?.blackjackNext?.blackjack;
  if (!deal || !final) return null;
  if (final.player.hands.length !== 1) return null;

  const playerDeal = deal.player.hands[0].cards.filter((c: any) => !c.face_down && c.rank).map(cardStr);
  const dealerUp = deal.dealer.hands[0].cards.filter((c: any) => !c.face_down && c.rank).map(cardStr)[0];
  const playerFinal = final.player.hands[0].cards.filter((c: any) => !c.face_down && c.rank).map(cardStr);
  const dealerFinal = final.dealer.hands[0].cards.filter((c: any) => !c.face_down && c.rank).map(cardStr);
  if (playerDeal.length < 2 || dealerFinal.length < 2 || !dealerUp) return null;

  const out: string[] = [];
  out[0] = playerDeal[0];   // cursor 0 — P1
  out[1] = dealerUp;         // cursor 1 — dealer up
  out[2] = playerDeal[1];   // cursor 2 — P2
  out[3] = dealerFinal[1];   // cursor 3 — dealer hole (revealed in final)

  // Cursor 4+: player additional cards (hits / double card), in order
  for (let i = 2; i < playerFinal.length; i++) out.push(playerFinal[i]);
  // Then dealer's additional draws
  for (let i = 2; i < dealerFinal.length; i++) out.push(dealerFinal[i]);
  return out;
}

/** Build a multiset of all visible cards across player sub-hands and dealer hand for a split bet. */
function buildSplitMultiset(bet: any): { count: number; multiset: Map<string, number> } | null {
  const deal = bet.deal?.blackjack;
  const final = bet.final?.blackjack || bet.final?.blackjackNext?.blackjack;
  if (!deal || !final) return null;

  const dealerUp = deal.dealer.hands[0].cards.filter((c: any) => !c.face_down && c.rank).map(cardStr)[0];
  const dealerFinal = final.dealer.hands[0].cards.filter((c: any) => !c.face_down && c.rank).map(cardStr);
  if (!dealerUp || dealerFinal.length < 2) return null;

  const ms = new Map<string, number>();
  const bump = (c: string) => ms.set(c, (ms.get(c) || 0) + 1);

  // The deal API records the player's two starting cards in deal.player.hands[0].cards.
  const playerDeal = deal.player.hands[0].cards.filter((c: any) => !c.face_down && c.rank).map(cardStr);
  if (playerDeal.length < 2) return null;
  bump(playerDeal[0]);     // P1 (cursor 0)
  bump(dealerUp);           // D up (cursor 1)
  bump(playerDeal[1]);     // P2 (cursor 2)
  bump(dealerFinal[1]);     // D hole (cursor 3)

  // Each split sub-hand starts with one of {P1, P2}; subsequent cards in that
  // sub-hand are drawn in order. Skip index 0 of each sub-hand (already counted).
  for (let h = 0; h < final.player.hands.length; h++) {
    const cards = final.player.hands[h].cards.filter((c: any) => !c.face_down && c.rank).map(cardStr);
    for (let i = 1; i < cards.length; i++) bump(cards[i]);
  }
  // Dealer additional draws (continuing the cursor stream)
  for (let i = 2; i < dealerFinal.length; i++) bump(dealerFinal[i]);

  let count = 0;
  for (const v of ms.values()) count += v;
  return { count, multiset: ms };
}

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 5: Outcome Recomputation ───────────────────────────────────────────
  {
    let verified = 0, mismatches = 0, skipped = 0, totalCardsVerified = 0;
    const examples: string[] = [];

    for (const bet of ctx.bets) {
      const seed = ctx.seedMap.get(bet.server_seed_hashed);
      if (!seed) { skipped++; continue; }

      const final = bet.final?.blackjack || bet.final?.blackjackNext?.blackjack;
      if (!final) { skipped++; continue; }
      const isSplit = final.player.hands.length > 1;

      let ok = true;
      let cardsChecked = 0;

      if (!isSplit) {
        const seq = buildNonSplitSequence(bet);
        if (!seq) { skipped++; continue; }
        for (let cursor = 0; cursor < seq.length; cursor++) {
          const got = getCard(seed, bet.client_seed, bet.nonce, cursor);
          if (got !== seq[cursor]) { ok = false; break; }
          cardsChecked++;
        }
      } else {
        const ms = buildSplitMultiset(bet);
        if (!ms) { skipped++; continue; }
        const recomputed = new Map<string, number>();
        for (let cursor = 0; cursor < ms.count; cursor++) {
          const c = getCard(seed, bet.client_seed, bet.nonce, cursor);
          recomputed.set(c, (recomputed.get(c) || 0) + 1);
        }
        if (recomputed.size !== ms.multiset.size) ok = false;
        if (ok) {
          for (const [k, v] of ms.multiset) {
            if (recomputed.get(k) !== v) { ok = false; break; }
          }
        }
        cardsChecked = ms.count;
      }

      if (ok) {
        verified++;
        totalCardsVerified += cardsChecked;
      } else {
        mismatches++;
        if (examples.length < 3) examples.push(`Bet ${bet.id} nonce=${bet.nonce} (${isSplit ? 'split' : 'non-split'})`);
      }
    }

    ctx.step5Mismatches = mismatches;
    ctx.step5Skipped = skipped;

    const detail = `${verified}/${ctx.bets.length} hands recomputed (${totalCardsVerified} card cursors verified — strict ordering for non-split, multiset for split). ${mismatches} mismatches, ${skipped} skipped.`;
    results.push(step(5, 'Outcome Recomputation',
      mismatches === 0 ? 'PASS' : 'FAIL',
      mismatches > 0 ? `${detail} Examples: ${examples.join(' | ')}` : detail
    ));
  }

  // ── Step 6: Client Seed Influence ───────────────────────────────────────────
  {
    let changed = 0, tested = 0;
    const sampleSize = Math.min(100, ctx.bets.length);

    for (let i = 0; i < sampleSize; i++) {
      const bet = ctx.bets[i];
      const serverSeed = ctx.seedMap.get(bet.server_seed_hashed);
      if (!serverSeed) continue;
      tested++;
      const correct = getCard(serverSeed, bet.client_seed, bet.nonce, 0);
      const wrong = getCard(serverSeed, 'wrong_seed_value_12345', bet.nonce, 0);
      if (correct !== wrong) changed++;
    }

    const pct = tested > 0 ? (changed / tested * 100).toFixed(1) : '0';
    // PASS criterion: at least 95% of sampled bets must diverge under the
    // wrong client seed. Under a fair RNG the divergence rate at cursor 0
    // alone is 51/52 ≈ 98.08%; a casino that secretly ignored the client
    // seed for most bets would fail this gate.
    const passThreshold = Math.ceil(tested * 0.95);
    const passed = changed >= passThreshold;
    results.push(step(6, 'Client Seed Influence',
      passed ? 'PASS' : 'FAIL',
      `${changed}/${tested} sampled bets produce different cards with wrong client seed (${pct}%). PASS criterion: changed >= 95% of sampled (>= ${passThreshold}/${tested}); observed: ${changed >= passThreshold ? 'YES' : 'NO'}.`
    ));
  }

  return results;
}
