/**
 * ONE ROUND — the served record, the declared draw order, an independent replay, and the settlement
 * derived from the cards.
 *
 * Three questions the suite used to answer from the operator's own summary fields:
 *   1. WHICH CURSOR DEALT WHICH CARD on a split round. Steps 5, 9 and 22 compared split rounds as a
 *      MULTISET of cursors 0..N−1, so two post-split cards served in swapped order passed. The draw
 *      order is a per-casino declaration (profile BLACKJACK-07); Duel's is
 *        P1 D1 P2 D2 · H1 second card · H2 second card · H1 plays out · H2 plays out · dealer draws
 *      and declaredOrder() below builds exactly that sequence, card for card.
 *   2. WHAT THE ACTIONS DID. replayRound() re-plays the recorded action tokens against the cards the
 *      seed produces, under the declared rules (src/config.ts RULES), without reading any served card:
 *      peek on naturals, split only as the first action on a rank pair, one card to each split ace,
 *      auto-stand at 21, double only as a hand's first action, dealer S17 unless every hand busted.
 *      Its hands must equal the served hands (profile BLACKJACK-10).
 *   3. WHO WON. settleRound() derives each hand's result and gross return from the recomputed cards —
 *      never from `hand.result`, the operator's label, which the suite used to switch on. The label is
 *      then RECONCILED against the derivation (profile BLACKJACK-13).
 */
import { getCard, handValue, cardRank } from './rng';
import { RULES_IN_EFFECT as R } from './config';
import { shouldDealerHit } from './strategy';

export const vis = (cs: any[] | undefined): string[] =>
  (cs || []).filter((c: any) => !c.face_down && c.rank).map((c: any) => String(c.rank) + String(c.suit));

export interface ServedHand { cards: string[]; doubled: boolean; result: string | null; type: string }
export interface ServedRound {
  playerDeal: string[];   // deal.player.hands[0] — P1, P2
  dealerUp: string;       // deal dealer up-card
  dealerFinal: string[];  // final dealer hand, hole revealed
  hands: ServedHand[];    // final player hands, in served order
}

export function finalOf(bet: any): any { return bet.final?.blackjack || bet.final?.blackjackNext?.blackjack; }

/** Read the served round, or null when the record cannot be read. */
export function servedRound(bet: any): ServedRound | null {
  const deal = bet.deal?.blackjack;
  const final = finalOf(bet);
  if (!deal || !final) return null;
  const playerDeal = vis(deal.player?.hands?.[0]?.cards);
  const dealerUp = vis(deal.dealer?.hands?.[0]?.cards)[0];
  const dealerFinal = vis(final.dealer?.hands?.[0]?.cards);
  const hands: ServedHand[] = (final.player?.hands || []).map((h: any) => ({
    cards: vis(h.cards), doubled: h.has_doubled === true, result: h.result ?? null, type: String(h.type),
  }));
  if (playerDeal.length !== 2 || !dealerUp || dealerFinal.length < 2 || hands.length < 1) return null;
  return { playerDeal, dealerUp, dealerFinal, hands };
}

/**
 * The served cards in the DECLARED draw order — cursor i of the returned list is the card the
 * casino says cursor i dealt. Unsplit: P1 D1 P2 D2, the player's extra cards, the dealer's draws.
 * Split (Duel declaration): P1 D1 P2 D2 · H1[1] · H2[1] · H1[2..] · H2[2..] · dealer[2..], and the
 * split hands must start with P1 and P2 respectively. Returns an error string when the served round
 * cannot be laid out in that order (a FAIL for the caller, never a skip).
 */
export function declaredOrder(s: ServedRound): { seq: string[] } | { error: string } {
  const [p1, p2] = s.playerDeal;
  if (s.dealerFinal[0] !== s.dealerUp) return { error: `final dealer up-card ${s.dealerFinal[0]} != dealt ${s.dealerUp}` };
  const head = [p1, s.dealerUp, p2, s.dealerFinal[1]];
  const dealerDraws = s.dealerFinal.slice(2);
  if (s.hands.length === 1) {
    const h = s.hands[0].cards;
    if (h[0] !== p1 || h[1] !== p2) return { error: `final hand starts ${h.slice(0, 2).join(',')}, dealt ${p1},${p2}` };
    return { seq: [...head, ...h.slice(2), ...dealerDraws] };
  }
  if (s.hands.length === 2) {
    const [h1, h2] = [s.hands[0].cards, s.hands[1].cards];
    if (h1[0] !== p1 || h2[0] !== p2) return { error: `split hands start ${h1[0]}/${h2[0]}, dealt ${p1}/${p2}` };
    if (h1.length < 2 || h2.length < 2) return { error: `split hand with ${h1.length}/${h2.length} cards` };
    return { seq: [...head, h1[1], h2[1], ...h1.slice(2), ...h2.slice(2), ...dealerDraws] };
  }
  return { error: `${s.hands.length} player hands (the declared maximum is 2 — one split)` };
}

export const isNatural = (cards: string[]): boolean => cards.length === 2 && handValue(cards).best === 21;

export interface ReplayHand { cards: string[]; doubled: boolean; fromSplit: boolean; splitAces: boolean }
export interface Replay {
  hands: ReplayHand[];
  dealer: string[];
  cursorsUsed: number;
  playerNatural: boolean;
  dealerNatural: boolean;
  insuranceOffered: boolean;
  insuranceTaken: boolean;
  split: boolean;
  /** Player card count of every hand after each token, for the per-response cross-check. */
  snapshots: number[][];
  /** Grammar violations — tokens the declared rules could not have produced. */
  violations: string[];
}

/**
 * Replay a round from (serverSeed, clientSeed, nonce) and the recorded action tokens alone.
 * `draw` may be supplied to replay against a fixed card list instead of the RNG (unit tests).
 */
export function replayRound(serverSeed: string, clientSeed: string, nonce: number, actions: string[],
  draw?: (cursor: number) => string): Replay {
  let cursor = 0;
  const next = (): string => (draw ? draw(cursor++) : getCard(serverSeed, clientSeed, nonce, cursor++));
  const v: string[] = [];
  const snapshots: number[][] = [];
  const p1 = next(), up = next(), p2 = next(), hole = next();
  const dealer = [up, hole];
  const playerNatural = isNatural([p1, p2]);
  const dealerNatural = isNatural(dealer);
  const insuranceOffered = cardRank(up) === 'A';

  let i = 0;
  let insuranceTaken = false;
  const snap = (hs: ReplayHand[]) => snapshots.push(hs.map(h => h.cards.length));

  // G1 — insurance token: first, and present iff the up-card is an Ace.
  const insTok = actions[0] === 'no_insurance' || actions[0] === 'insurance';
  if (insTok !== insuranceOffered) v.push(`insurance token ${insTok ? 'present' : 'absent'} with a ${cardRank(up)} up-card`);
  let hands: ReplayHand[] = [{ cards: [p1, p2], doubled: false, fromSplit: false, splitAces: false }];
  if (insTok) { insuranceTaken = actions[0] === 'insurance'; i++; snap(hands); }
  if (actions.slice(i).some(a => a === 'no_insurance' || a === 'insurance')) v.push('insurance token after the first position');

  let split = false;
  if (!(playerNatural || dealerNatural)) {
    if (actions[i] === 'split') {
      i++;
      if (cardRank(p1) !== cardRank(p2)) v.push(`split on ${p1},${p2} — not a rank pair`);
      split = true;
      const aces = cardRank(p1) === 'A' && R.splitAcesOneCard;
      hands = [
        { cards: [p1, next()], doubled: false, fromSplit: true, splitAces: aces },
        { cards: [p2, next()], doubled: false, fromSplit: true, splitAces: aces },
      ];
      snap(hands);
    }
    for (const h of hands) {
      if (h.splitAces) continue;                          // one card to each split ace
      for (;;) {
        if (handValue(h.cards).best >= 21) break;         // bust, or auto-stand at 21
        const a = actions[i];
        if (a === undefined) { v.push(`hand ${h.cards.join(',')} (${handValue(h.cards).best}) ends with no terminal token`); break; }
        i++;
        if (a === 'hit') { h.cards.push(next()); snap(hands); continue; }
        if (a === 'stand') { snap(hands); break; }
        if (a === 'double') {
          if (h.cards.length !== 2) v.push(`double on a ${h.cards.length}-card hand`);
          if (h.fromSplit && !R.das) v.push('double after a split, which the declared rules (no DAS) forbid');
          h.cards.push(next()); h.doubled = true; snap(hands); break;
        }
        v.push(`token \`${a}\` inside a hand`); snap(hands); break;
      }
    }
    if (hands.some(h => handValue(h.cards).best <= 21)) {
      while (shouldDealerHit(dealer, R.soft17)) dealer.push(next());   // RULES.dealerSoft17
    }
  }
  if (i < actions.length) v.push(`${actions.length - i} token(s) after the round was over: ${actions.slice(i).join(',')}`);

  return { hands, dealer, cursorsUsed: cursor, playerNatural, dealerNatural, insuranceOffered, insuranceTaken, split, snapshots, violations: v };
}

/** Result category and gross return, in HALF-stakes (×2 so 3:2 stays an integer). */
export interface HandSettlement { result: 'blackjack' | 'win' | 'push' | 'lose' | 'bust'; halfStakes: bigint }

/**
 * Settle every hand from its cards under the declared rules: natural vs natural → push (gross 1);
 * player natural → 2.5; dealer natural → 0 (peek: the player never acted); otherwise bust → 0, dealer
 * bust or higher total → win (2 per unit wagered), equal → push (1), lower → lose (0). A doubled
 * hand wagers 2 units; a two-card 21 after a split is NOT a natural and settles as a total.
 */
export function settleRound(hands: Array<{ cards: string[]; doubled: boolean }>, dealer: string[], split: boolean): HandSettlement[] {
  const playerNatural = !split && hands.length === 1 && isNatural(hands[0].cards);
  const dealerNatural = isNatural(dealer.slice(0, 2));
  if (playerNatural && dealerNatural) return [{ result: 'push', halfStakes: 2n }];
  if (playerNatural) return [{ result: 'blackjack', halfStakes: R.naturalHalfStakes }];
  if (dealerNatural) return hands.map(() => ({ result: 'lose' as const, halfStakes: 0n }));
  const d = handValue(dealer).best;
  return hands.map(h => {
    const w = h.doubled ? 2n : 1n;
    const t = handValue(h.cards).best;
    if (t > 21) return { result: 'bust' as const, halfStakes: 0n };
    if (d > 21 || t > d) return { result: 'win' as const, halfStakes: 4n * w };
    if (t === d) return { result: 'push' as const, halfStakes: 2n * w };
    return { result: 'lose' as const, halfStakes: 0n };
  });
}

/** The recomputed hands of a served round: the served LAYOUT, every card taken from the RNG at its declared cursor. */
export function recomputedHands(s: ServedRound, serverSeed: string, clientSeed: string, nonce: number):
  { hands: Array<{ cards: string[]; doubled: boolean }>; dealer: string[] } {
  const c = (k: number) => getCard(serverSeed, clientSeed, nonce, k);
  const dealerN = s.dealerFinal.length;
  if (s.hands.length === 1) {
    const n = s.hands[0].cards.length;
    const cards = [c(0), c(2)];
    for (let k = 0; k < n - 2; k++) cards.push(c(4 + k));
    const dealer = [c(1), c(3)];
    for (let k = 0; k < dealerN - 2; k++) dealer.push(c(4 + (n - 2) + k));
    return { hands: [{ cards, doubled: s.hands[0].doubled }], dealer };
  }
  const [n1, n2] = [s.hands[0].cards.length, s.hands[1].cards.length];
  const h1 = [c(0), c(4)], h2 = [c(2), c(5)];
  let k = 6;
  for (let j = 2; j < n1; j++) h1.push(c(k++));
  for (let j = 2; j < n2; j++) h2.push(c(k++));
  const dealer = [c(1), c(3)];
  for (let j = 2; j < dealerN; j++) dealer.push(c(k++));
  return { hands: [{ cards: h1, doubled: s.hands[0].doubled }, { cards: h2, doubled: s.hands[1].doubled }], dealer };
}
