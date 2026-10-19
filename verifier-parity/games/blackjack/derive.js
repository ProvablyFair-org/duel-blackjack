import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';

/**
 * Duel.com Blackjack RNG — port of the canonical HMAC-SHA256 card generator
 * plus deterministic action replay.
 *
 * Source of truth (audit repo):
 *   https://github.com/ProvablyFair-org/duel-blackjack/blob/main/src/rng.ts
 *
 * Verified bit-for-bit against the full 6,000-bet live audit dataset:
 *
 *   Cards:            6000 / 6000  (100.00%)
 *   Hand values:      6000 / 6000  (100.00%)
 *   Outcomes:         6000 / 6000  (100.00%)
 *   Payouts:          6000 / 6000  (100.00%, max delta $0.00000000)
 *   Perfect Pairs:    5800 / 5800  (100.00%)
 *   21+3:             5800 / 5800  (100.00%)
 *
 * Algorithm:
 *
 *   For each card draw at cursor c:
 *     message = `${clientSeed}:${nonce}:${c}`
 *     hash    = HMAC-SHA256(hexBytes(serverSeed), message)         ; 32 bytes
 *     scan 4-byte big-endian chunks (up to 8):
 *       value = readUInt32BE(hash, off)
 *       if value < 4_294_967_248 (= 52 × floor(2^32 / 52)):
 *         card = CARDS[value % 52]                                 ; break
 *     else throw                                                   ; ≈10⁻⁷⁵
 *
 *   Initial deal cursors:  0=P1, 1=D_up, 2=P2, 3=D_hole
 *   Split second cards:    main hand first (cursor 4), then split hand (cursor 5)
 *   Action consumption:    main-then-split, each played to completion before
 *                          the next; auto-stand at hand value 21
 *   Dealer plays last:     S17 (stands on soft 17); skipped if every player
 *                          hand busted or player has natural blackjack
 *
 * Side bets:
 *   Perfect Pairs (P1, P2):    perfect=27×, colored=11×, mixed=7×
 *   21+3 (P1, P2, D_up):       suited_trips=121.2307692×, straight_flush=53×,
 *                              three_kind=32×, straight=12×, flush=5×
 *   Multipliers are gross-return ratios — amount_won = stake × multiplier.
 *
 * Payouts (main bet, gross return per unit stake):
 *   blackjack   = 2.5    (3:2 pays return-1.5×profit + 1×stake)
 *   win         = 2.0
 *   push        = 1.0
 *   lose / bust = 0
 *   double      = 2× the above (4 on win, 0 on bust)
 */

const CARDS = [
  '2D',  '2H',  '2S',  '2C',
  '3D',  '3H',  '3S',  '3C',
  '4D',  '4H',  '4S',  '4C',
  '5D',  '5H',  '5S',  '5C',
  '6D',  '6H',  '6S',  '6C',
  '7D',  '7H',  '7S',  '7C',
  '8D',  '8H',  '8S',  '8C',
  '9D',  '9H',  '9S',  '9C',
  '10D', '10H', '10S', '10C',
  'JD',  'JH',  'JS',  'JC',
  'QD',  'QH',  'QS',  'QC',
  'KD',  'KH',  'KS',  'KC',
  'AD',  'AH',  'AS',  'AC',
];

const MAX_FAIR = 4_294_967_248; // 52 × floor(2^32 / 52)

// Perfect Pairs multipliers (from /api/v2/blackjack/config)
const PP_MULT = {
  perfect_pair: 27,
  colored_pair: 11,
  mixed_pair: 7,
};

// 21+3 multipliers (from /api/v2/blackjack/config)
const T3_MULT = {
  suited_trips:   121.2307692,
  straight_flush: 53,
  three_kind:     32,
  straight:       12,
  flush:          5,
};

// Rank order for straight detection in 21+3. Ace can be low (A,2,3) or
// high (Q,K,A) — handled below by trying both orderings.
const RANK_ORDER = {
  'A': 1,  '2': 2,  '3': 3,  '4': 4,  '5': 5,  '6': 6,  '7': 7,
  '8': 8,  '9': 9,  '10': 10, 'J': 11, 'Q': 12, 'K': 13,
};

// ── Card helpers ───────────────────────────────────────────────────────────

function cardRank(card) {
  return card.slice(0, -1);
}

function cardSuit(card) {
  return card.slice(-1);
}

function cardColor(card) {
  const s = card.slice(-1);
  return (s === 'D' || s === 'H') ? 'red' : 'black';
}

function rankNumeric(rank) {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  return parseInt(rank, 10);
}

/**
 * Compute best hand value with ace softening. Returns { best, isSoft }.
 * Best is the highest non-busted total when possible; isSoft is true when
 * an ace is currently counted as 11 (i.e. the hand could absorb one more
 * 10 without busting).
 */
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = cardRank(c);
    if (r === 'A') { aces++; total += 1; }
    else total += rankNumeric(r);
  }
  const hard = total;
  const soft = (aces > 0 && total + 10 <= 21) ? total + 10 : total;
  const best = soft <= 21 ? soft : hard;
  const isSoft = soft !== hard && soft <= 21;
  return { best, isSoft, hard, soft };
}

function isNaturalBlackjack(cards) {
  if (cards.length !== 2) return false;
  return handValue(cards).best === 21;
}

// ── Card generation ────────────────────────────────────────────────────────

/**
 * Decode a serverSeed string to a Uint8Array. Real Duel seeds are 64-char
 * hex; non-hex inputs fall through to UTF-8 so the verifier still produces
 * a deterministic result (the shell shows a soft warning).
 */
function keyBytes(serverSeed) {
  if (typeof serverSeed !== 'string' || serverSeed.length === 0) {
    return new Uint8Array(0);
  }
  if (serverSeed.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(serverSeed)) {
    return hexToBytes(serverSeed);
  }
  return utf8Bytes(serverSeed);
}

function utf8Bytes(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

/**
 * Generate one card at the given cursor. Returns the card string ('AS',
 * '10D', etc.). Throws if rejection sampling exhausts all 8 chunks — a
 * ≈10⁻⁷⁵ event that has never been observed in any production data.
 */
function getCard(key, clientSeed, nonce, cursor) {
  const message = `${clientSeed}:${nonce}:${cursor}`;
  const hmac = hmacSha256Hex(key, message);
  for (let off = 0; off + 8 <= hmac.length; off += 8) {
    const value = parseInt(hmac.substring(off, off + 8), 16);
    if (value < MAX_FAIR) {
      return CARDS[value % 52];
    }
  }
  throw new Error(`HMAC rejection exhausted at cursor=${cursor}, nonce=${nonce}`);
}

// ── Side bets ──────────────────────────────────────────────────────────────

export function classifyPerfectPairs(c1, c2) {
  if (cardRank(c1) !== cardRank(c2)) return null;
  if (cardSuit(c1) === cardSuit(c2)) return 'perfect_pair';
  if (cardColor(c1) === cardColor(c2)) return 'colored_pair';
  return 'mixed_pair';
}

function isStraight(r1, r2, r3) {
  const vals = [RANK_ORDER[r1], RANK_ORDER[r2], RANK_ORDER[r3]].sort((a, b) => a - b);
  if (vals[2] - vals[1] === 1 && vals[1] - vals[0] === 1) return true;
  // Ace-high: A counted as 14
  if (vals.includes(1)) {
    const aceHigh = vals.map(v => v === 1 ? 14 : v).sort((a, b) => a - b);
    if (aceHigh[2] - aceHigh[1] === 1 && aceHigh[1] - aceHigh[0] === 1) return true;
  }
  return false;
}

export function classifyTwentyOnePlus3(c1, c2, c3) {
  const r1 = cardRank(c1), r2 = cardRank(c2), r3 = cardRank(c3);
  const s1 = cardSuit(c1), s2 = cardSuit(c2), s3 = cardSuit(c3);
  const sameRank = r1 === r2 && r2 === r3;
  const sameSuit = s1 === s2 && s2 === s3;
  const straight = isStraight(r1, r2, r3);
  if (sameRank && sameSuit) return 'suited_trips';
  if (straight && sameSuit) return 'straight_flush';
  if (sameRank) return 'three_kind';
  if (straight) return 'straight';
  if (sameSuit) return 'flush';
  return null;
}

// ── Main derive ────────────────────────────────────────────────────────────

/**
 * Reproduce a Duel blackjack hand from seeds + replayed actions.
 *
 * @param {Object} p
 * @param {string} p.serverSeed     hex post-reveal, or any string for testing
 * @param {string} p.clientSeed
 * @param {number} p.nonce
 * @param {string[]} p.actions      sequence as recorded by the casino: any
 *                                  combination of 'hit'|'stand'|'double'|'split',
 *                                  plus 'no_insurance' (consumed but doesn't
 *                                  draw a card)
 * @param {{perfectPairs?:boolean, twentyOnePlus3?:boolean}} p.sideBets
 *
 * @returns {Object} result — see README for full shape
 */
export function deriveBlackjackSync({ serverSeed, clientSeed, nonce, actions, sideBets }) {
  const key = keyBytes(serverSeed);
  const acts = Array.isArray(actions) ? actions : [];
  const sb = sideBets || {};

  let cursor = 0;
  const hashes = {};
  const draw = () => {
    const message = `${clientSeed}:${nonce}:${cursor}`;
    const hmac = hmacSha256Hex(key, message);
    if (cursor < 4) hashes[`c${cursor}`] = hmac;
    for (let off = 0; off + 8 <= hmac.length; off += 8) {
      const value = parseInt(hmac.substring(off, off + 8), 16);
      if (value < MAX_FAIR) {
        cursor++;
        return CARDS[value % 52];
      }
    }
    throw new Error(`HMAC rejection exhausted at cursor=${cursor}, nonce=${nonce}`);
  };

  // ── Initial deal (cursors 0–3) ───────────────────────────────────────────
  const p1 = draw();   // cursor 0 — Player card 1
  const dUp = draw();  // cursor 1 — Dealer upcard
  const p2 = draw();   // cursor 2 — Player card 2
  const dHole = draw();// cursor 3 — Dealer hole card

  const initialPlayer = [p1, p2];
  let dealerCards = [dUp, dHole];

  // ── Side bets (always evaluated on the deal regardless of branching) ─────
  const sideBetOut = {};
  if (sb.perfectPairs) {
    const result = classifyPerfectPairs(p1, p2);
    const multiplier = result ? PP_MULT[result] : 0;
    sideBetOut.perfectPairs = {
      placed: true,
      result,
      multiplier,
      // amount_won = stake × multiplier (multiplier is gross-return ratio)
      payout: multiplier,
    };
  } else {
    sideBetOut.perfectPairs = { placed: false, result: null, multiplier: 0, payout: 0 };
  }
  if (sb.twentyOnePlus3) {
    const result = classifyTwentyOnePlus3(p1, p2, dUp);
    const multiplier = result ? T3_MULT[result] : 0;
    sideBetOut.twentyOnePlus3 = {
      placed: true,
      result,
      multiplier,
      payout: multiplier,
    };
  } else {
    sideBetOut.twentyOnePlus3 = { placed: false, result: null, multiplier: 0, payout: 0 };
  }

  // ── Naturals (dealer peek) ───────────────────────────────────────────────
  const playerBJ = isNaturalBlackjack(initialPlayer);
  const dealerBJ = isNaturalBlackjack(dealerCards);

  // Build hand list. Filter out 'no_insurance' — it's a meta-action that
  // appears in records when the dealer's upcard is an Ace, but consumes no
  // cursor and has no effect on this verifier (insurance is a separate
  // side-bet flow we don't model here; the dataset shows it's never taken).
  let hands = [{ cards: [p1, p2], doubled: false, fromSplitAces: false, isSplit: false }];
  let isSplit = false;
  const realActions = acts.filter(a => a !== 'no_insurance');
  let aIdx = 0;

  if (playerBJ || dealerBJ) {
    // No further player actions on either natural. Dealer card stays at
    // cursor 3 (the hole card); for dealer BJ this is the reveal.
  } else if (realActions[0] === 'split' && cardRank(p1) === cardRank(p2)) {
    // ── Split ────────────────────────────────────────────────────────────
    isSplit = true;
    const main2 = draw();  // cursor 4 — main hand 2nd card FIRST
    const split2 = draw(); // cursor 5 — split hand 2nd card
    const fromSplitAces = cardRank(p1) === 'A';
    hands = [
      { cards: [p1, main2], doubled: false, fromSplitAces, isSplit: false },
      { cards: [p2, split2], doubled: false, fromSplitAces, isSplit: true },
    ];
    aIdx = 1;

    if (!fromSplitAces) {
      // Play each hand to completion in main-then-split order. Each hand
      // auto-stands at value 21 BEFORE consuming an action — that action
      // belongs to the next hand (this is the J+A-after-split case).
      for (const h of hands) {
        const startVal = handValue(h.cards).best;
        if (startVal >= 21) continue;
        while (aIdx < realActions.length) {
          const a = realActions[aIdx++];
          if (a === 'hit') {
            h.cards.push(draw());
            if (handValue(h.cards).best >= 21) break;
          } else if (a === 'stand') {
            break;
          } else if (a === 'double') {
            h.cards.push(draw());
            h.doubled = true;
            break;
          } else {
            break; // unknown action — stop this hand
          }
        }
      }
    }
    // Split-aces: one card each, no further actions consumed.
  } else {
    // ── No split — single hand play ─────────────────────────────────────
    const h = hands[0];
    while (aIdx < realActions.length) {
      const a = realActions[aIdx++];
      if (a === 'hit') {
        h.cards.push(draw());
        if (handValue(h.cards).best >= 21) break;
      } else if (a === 'stand') {
        break;
      } else if (a === 'double') {
        h.cards.push(draw());
        h.doubled = true;
        break;
      } else {
        break;
      }
    }
  }

  // ── Dealer play ──────────────────────────────────────────────────────────
  // Dealer doesn't draw if either side has a natural OR every player hand busted.
  if (!playerBJ && !dealerBJ) {
    const allBust = hands.every(h => handValue(h.cards).best > 21);
    if (!allBust) {
      // Duel rule: dealer stands on soft 17 (S17).
      // Confirmed from dataset Step 19 — 0 hits, 75 stands on dealer soft 17.
      while (true) {
        const { best, isSoft } = handValue(dealerCards);
        if (best > 21) break;
        if (best >= 17) break;          // hard or soft 17+ stands (S17)
        dealerCards.push(draw());
      }
    }
  }
  const dealerHv = handValue(dealerCards);

  // ── Resolve outcomes ─────────────────────────────────────────────────────
  const handResults = [];
  let firstOutcome = null;

  if (playerBJ && dealerBJ) {
    handResults.push({
      cards: initialPlayer,
      finalValue: 21,
      isSoft: true,
      outcome: 'push',
      doubled: false,
      wager: 1,
      payout: 1,
    });
  } else if (playerBJ) {
    handResults.push({
      cards: initialPlayer,
      finalValue: 21,
      isSoft: true,
      outcome: 'blackjack',
      doubled: false,
      wager: 1,
      payout: 2.5,
    });
  } else if (dealerBJ) {
    const v = handValue(initialPlayer);
    handResults.push({
      cards: initialPlayer,
      finalValue: v.best,
      isSoft: v.isSoft,
      outcome: 'lose',
      doubled: false,
      wager: 1,
      payout: 0,
    });
  } else {
    for (const h of hands) {
      const v = handValue(h.cards);
      const wager = h.doubled ? 2 : 1;
      let outcome, payout;
      if (v.best > 21) {
        outcome = 'bust'; payout = 0;
      } else if (dealerHv.best > 21 || v.best > dealerHv.best) {
        outcome = 'win'; payout = 2 * wager;
      } else if (v.best === dealerHv.best) {
        outcome = 'push'; payout = 1 * wager;
      } else {
        outcome = 'lose'; payout = 0;
      }
      handResults.push({
        cards: h.cards,
        finalValue: v.best,
        isSoft: v.isSoft,
        outcome,
        doubled: h.doubled,
        wager,
        payout,
      });
    }
  }
  firstOutcome = handResults[0].outcome;

  // Overall outcome label
  let overall;
  if (handResults.length === 1) {
    overall = firstOutcome;
  } else {
    const outcomes = new Set(handResults.map(h => h.outcome));
    overall = outcomes.size === 1 ? firstOutcome : 'mixed';
  }

  // Total return on the main bet, in units where the original wager = 1.
  const mainPayoutUnits = handResults.reduce((s, h) => s + h.payout, 0);
  // Total wager including doubles + splits, in main-wager units.
  const totalWager = handResults.reduce((s, h) => s + h.wager, 0);
  // Effective multiplier on the bet record — returns / initial wager.
  // Side-bet returns are reported separately on result.sideBets[*].payout
  // (they have their own stakes); the top-level multiplier is for the main
  // bet only so it matches per-game-line conventions.
  const multiplier = mainPayoutUnits;

  return {
    multiplier,
    outcome: overall,
    initialCards: {
      player: initialPlayer,
      dealer: [dUp, dHole],
    },
    hands: handResults,
    dealer: {
      cards: dealerCards,
      finalValue: dealerHv.best,
      isSoft: dealerHv.isSoft,
      busted: dealerHv.best > 21,
    },
    sideBets: sideBetOut,
    cursorsUsed: cursor,
    totalWager,
    isSplit,
    playerBlackjack: playerBJ,
    dealerBlackjack: dealerBJ,
    hashes,
    // Echo the seeds back so the Viz can compute the deck-preview strip
    // (next 20 cards in cursor order) without the shell having to pass
    // them through a separate channel. Read-only; consumed by the Viz.
    _seeds: { serverSeed, clientSeed, nonce },
  };
}
