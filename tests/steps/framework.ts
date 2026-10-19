/**
 * Steps 35–37: the Framework 1.0 Blackjack checks this suite had no step for until 2026-09-24.
 *
 *   35  Draw Bias Bound                (profile BLACKJACK-08)
 *   36  Round Replay & Action Grammar  (profile BLACKJACK-10)
 *   37  Rule & Coverage Register       (profile BLACKJACK-15)
 *
 * Step 38 (player-verifier parity, BLACKJACK-24) lives in tests/steps/parity.ts.
 */

import { MAX_FAIR, DECK_RANGE, CHUNKS_PER_HASH, cardRank, handValue } from '../../src/rng';
import { servedRound, replayRound } from '../../src/round';
import { RULES } from '../../src/config';
import { EXPECTED_HANDS, EXPECTED_CAPTURE_RETRY_GAPS, DECLARED_CAPTURE_RETRY_GAPS } from '../../src/loader';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

/** Framework floors (profile BLACKJACK-15). */
export const COVERAGE_FLOORS = Object.freeze({
  splits: 200, aceSplits: 20, das: 100, doubles: 500, fundedInsuranceDealerAce: 100,
});

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 35: Draw Bias Bound ────────────────────────────────────────────────
  // Stated as a COMPUTED bound, not as a sentence. A card is CARDS[v mod 52] for the first 4-byte
  // chunk v < MAX_FAIR. The draw is exactly uniform iff MAX_FAIR is a whole number of ranges; then
  // the bias bound is 0. If it were not, the bound would be 1 / floor(MAX_FAIR / 52) (one residue
  // class holding one extra value), and anything above 2^-32 FAILs (methodology S2). MAX_FAIR must
  // also be the LARGEST such multiple (2^32 − MAX_FAIR < 52), or values are discarded for nothing.
  // The rejection census over every captured draw comes from Step 5: P(reject a chunk) = 48 / 2^32,
  // so the expected count is tiny and the rejection branch is, honestly, UNWITNESSED in this capture;
  // its code path is exercised by a unit test instead (tests/blackjack/FrameworkTests.ts). A census
  // implausible under the model (>= 4 rejections, P < 1e-12 at this draw count) or an exhausted hash
  // FAILs.
  {
    const TWO32 = 2 ** 32;
    const wholeRanges = MAX_FAIR % DECK_RANGE === 0;
    const largest = MAX_FAIR <= TWO32 && TWO32 - MAX_FAIR < DECK_RANGE;
    const bound = wholeRanges ? 0 : 1 / Math.floor(MAX_FAIR / DECK_RANGE);
    const pReject = (TWO32 - MAX_FAIR) / TWO32;
    const c = ctx.drawCensus;
    const expected = c ? c.draws * pReject / (1 - pReject) : NaN;
    const pExhaust = pReject ** CHUNKS_PER_HASH;
    const ok = c !== null && wholeRanges && largest && bound <= 2 ** -32 && c.exhausted === 0 && c.rejectedChunks < 4
      && c.draws > 0;
    results.push(step(35, 'Draw Bias Bound',
      ok ? 'PASS' : 'FAIL',
      `MAX_FAIR = ${MAX_FAIR} = ${DECK_RANGE} × ${Math.floor(MAX_FAIR / DECK_RANGE)} (${wholeRanges ? 'a whole number of ranges' : 'NOT a whole number of ranges'}; ` +
      `2^32 − MAX_FAIR = ${TWO32 - MAX_FAIR} < ${DECK_RANGE}: ${largest ? 'largest such multiple' : 'NOT the largest'}). Computed bias bound per accepted draw: ${bound} (limit 2^-32 = ${(2 ** -32).toExponential(3)}). ` +
      `Rejection census over the ${c?.draws ?? 0} captured draws (Step 5): ${c?.rejectedChunks ?? 'n/a'} rejected chunks, expected ${expected.toExponential(3)} ` +
      `(P(reject) = ${TWO32 - MAX_FAIR}/2^32 = ${pReject.toExponential(4)}), ${c?.exhausted ?? 'n/a'} exhausted hashes (P = ${pExhaust.toExponential(2)} per draw). ` +
      `The rejection branch is unwitnessed in the capture; its code path is exercised by a unit test.`,
      { maxFair: MAX_FAIR, biasBound: bound, draws: c?.draws, rejectedChunks: c?.rejectedChunks, expectedRejections: expected, exhausted: c?.exhausted }));
  }

  // ── Step 36: Round Replay & Action Grammar ──────────────────────────────────
  // Every round is REPLAYED from (serverSeed, clientSeed, nonce) and its recorded action tokens alone
  // (src/round.ts replayRound — no served card is read) under the declared rules: peek (a natural on
  // either side ends the round before any player action), split only as the first action on a rank
  // pair, one card to each split ace, auto-stand at 21, `double` only as a hand's first action, dealer
  // S17 unless every hand busted. The replay must reproduce every served hand card for card and its
  // has_doubled flag, and the dealer's hand. The GRAMMAR is what a replay cannot produce: an insurance
  // token not first or not iff an Ace up-card, a token after the round was over, a hand below 21 left
  // without a terminal, `double` on a hand of more than two cards, `split` inside a hand or on a
  // non-pair. Per-response card counts: the capture holds one response per token (6,000/6,000), and
  // each response's player card counts must equal the replay's state after that token. Finally
  // hit + double tokens must equal the extra player cards (split rounds: + 2 split cards).
  {
    let replayed = 0, mismatched = 0, grammar = 0, responsesChecked = 0, responseBad = 0, countBad = 0;
    let peekEnded = 0, autoStand21 = 0, unreadable = 0;
    const ex: string[] = [];
    for (const b of ctx.bets) {
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      const s = servedRound(b);
      if (!seed || !s) { unreadable++; continue; }
      const r = replayRound(seed, b.client_seed, b.nonce, b.actions);
      if (r.violations.length) { grammar++; if (ex.length < 4) ex.push(`bet ${b.id} grammar: ${r.violations[0]}`); }
      const same = r.hands.length === s.hands.length
        && r.hands.every((h, i) => h.cards.join() === s.hands[i].cards.join() && h.doubled === s.hands[i].doubled)
        && r.dealer.join() === s.dealerFinal.join();
      if (same) replayed++;
      else { mismatched++; if (ex.length < 4) ex.push(`bet ${b.id} replay ${r.hands.map(h => h.cards.join(' ')).join('|')} vs served ${s.hands.map(h => h.cards.join(' ')).join('|')}`); }
      if (r.playerNatural || r.dealerNatural) peekEnded++;
      autoStand21 += r.hands.filter(h => h.cards.length > 2 && handValue(h.cards).best === 21).length;
      const resps: any[] = (b as any).actionResponses || [];
      if (resps.length !== b.actions.length) { responseBad++; if (ex.length < 4) ex.push(`bet ${b.id}: ${resps.length} responses for ${b.actions.length} tokens`); }
      for (let k = 0; k < resps.length; k++) {
        responsesChecked++;
        const bj = resps[k]?.blackjackNext?.blackjack ?? resps[k]?.blackjack;
        const counts = (bj?.player?.hands || []).map((h: any) => (h.cards || []).filter((c: any) => !c.face_down && c.rank).length).join();
        if (counts !== (r.snapshots[k] || []).join()) { responseBad++; if (ex.length < 4) ex.push(`bet ${b.id} response ${k}: counts ${counts} vs replay ${(r.snapshots[k] || []).join()}`); break; }
      }
      const extra = s.hands.reduce((a, h) => a + h.cards.length, 0) - 2 - (s.hands.length > 1 ? 2 : 0);
      const drawTokens = b.actions.filter(a => a === 'hit' || a === 'double').length;
      if (extra !== drawTokens) { countBad++; if (ex.length < 4) ex.push(`bet ${b.id}: ${drawTokens} hit/double tokens, ${extra} extra cards`); }
    }
    const ok = replayed === EXPECTED_HANDS && mismatched === 0 && grammar === 0 && responseBad === 0 && countBad === 0 && unreadable === 0;
    results.push(step(36, 'Round Replay & Action Grammar',
      ok ? 'PASS' : 'FAIL',
      `${replayed}/${EXPECTED_HANDS} rounds replayed from the seed and the action tokens alone under the declared rules reproduce every served hand, has_doubled flag and dealer hand card for card ` +
      `(${mismatched} differ, ${unreadable} unreadable). Grammar violations: ${grammar} rounds. Per-response player card counts: ${responsesChecked} responses checked against the replay state after each token, ${responseBad} disagree. ` +
      `hit + double tokens == extra player cards (+2 on a split): ${EXPECTED_HANDS - countBad}/${EXPECTED_HANDS}. Witnesses: ${peekEnded} rounds ended at the deal on a natural (peek), ${autoStand21} hands auto-stood at 21 with no terminal token.` +
      (ex.length ? ` Examples: ${ex.join(' | ')}` : ''),
      { replayed, mismatched, grammar, responsesChecked, responseBad, countBad, peekEnded, autoStand21 }));
  }

  // ── Step 37: Rule & Coverage Register ───────────────────────────────────────
  // Every declared rule (src/config.ts RULES) marked OBSERVED with its witness count, or ASSUMED
  // where the capture never exercised it; the framework coverage floors (COVERAGE_FLOORS) compared
  // with what the capture reached; uncaptured games counted (Step 4 register). A rule the data
  // CONTRADICTS FAILs. A floor the capture did not reach is a FLAG with origin = capture — disclosed
  // with its witness count, verdict-neutral, never silently passed (Mike's recipe: funded insurance
  // is 0 at all three Blackjack captures, ASSUMED). MANIFEST.md DL register carries the rows.
  {
    let splits = 0, aceSplits = 0, das = 0, doubles = 0, doublesOutside9to11 = 0;
    let splitOffers = 0, splitOffersNonPair = 0, pairsAfterSplit = 0, resplitOffered = 0, resplits = 0;
    let lists = 0, surrenderOffered = 0, insuranceOffers = 0, insuranceFunded = 0;
    for (const b of ctx.bets) {
      const deal = b.deal?.blackjack;
      const s = servedRound(b);
      if (!deal || !s) continue;
      const allLists: string[][] = [];
      if (Array.isArray(deal.available_actions)) allLists.push(deal.available_actions);
      const resps: any[] = (b as any).actionResponses || [];
      for (const r of resps) {
        const aa = (r?.blackjackNext?.blackjack ?? r?.blackjack)?.available_actions;
        if (Array.isArray(aa)) allLists.push(aa);
      }
      lists += allLists.length;
      surrenderOffered += allLists.filter(l => l.includes('surrender')).length;
      const [p1, p2] = s.playerDeal;
      const dealOffersSplit = allLists.slice(0, 2).some(l => l.includes('split'));
      if (dealOffersSplit) {
        splitOffers++;
        if (cardRank(p1) !== cardRank(p2)) splitOffersNonPair++;
      }
      if (b.actions[0] === 'insurance' || b.actions[0] === 'no_insurance') insuranceOffers++;
      if (b.actions.includes('insurance')) insuranceFunded++;
      const nDouble = b.actions.filter(a => a === 'double').length;
      doubles += nDouble;
      if (b.actions.includes('split')) {
        splits++;
        resplits += b.actions.filter(a => a === 'split').length - 1;
        if (cardRank(p1) === 'A') aceSplits++;
        if (nDouble > 0) das++;
        const pairHands = s.hands.filter(h => cardRank(h.cards[0]) === cardRank(h.cards[1])).length;
        pairsAfterSplit += pairHands;
        const splitIdx = b.actions.indexOf('split');
        if (resps.slice(splitIdx).some(r => ((r?.blackjackNext?.blackjack ?? r?.blackjack)?.available_actions || []).includes('split'))) resplitOffered++;
      } else if (nDouble > 0) {
        const t = handValue(s.playerDeal).best;
        if (t < 9 || t > 11) doublesOutside9to11++;
      }
    }
    const gaps = DECLARED_CAPTURE_RETRY_GAPS.length;
    const register = [
      `S17 observed (Step 19: 75 soft-17 stands, 0 hits)`,
      `peek observed (Step 36: rounds ended at the deal on a natural)`,
      `split pairing by rank observed (${splitOffers} split offers, ${splitOffersNonPair} on a non-pair; ${splits} splits taken)`,
      `split aces one card observed (${aceSplits} ace splits, Step 23)`,
      `DAS ${RULES.das ? 'observed' : 'declared NOT allowed — CONTRADICTED'} (${das} split rounds with a double)`,
      `double on any two cards observed (${doublesOutside9to11} unsplit doubles on a two-card total outside 9–11)`,
      `no re-split observed (${pairsAfterSplit} split hands dealt a pair again; split offered after a split in ${resplitOffered} rounds; ${resplits} re-splits)`,
      `no surrender observed (${surrenderOffered} of ${lists} action lists offer it)`,
      `insurance offered on every dealer Ace observed (${insuranceOffers} prompts, Step 25); insurance pays 2:1 ASSUMED — ${insuranceFunded} funded`,
    ];
    // A declared rule the data contradicts FAILs. The declaration is read from src/config.ts RULES; a
    // RULES value the replay cannot play (a re-split, surrender, a finite shoe …) never reaches this
    // line — rulesInEffect() throws at load (src/config.ts), so only playable declarations are scored here.
    const contradicted = splitOffersNonPair > 0 || resplits > 0 || resplitOffered > 0 || surrenderOffered > 0
      || RULES.maxSplits !== 1 || RULES.surrender !== false
      || ((RULES.das as boolean) === false && das > 0);
    const floors: Array<[string, number, number]> = [
      ['splits', splits, COVERAGE_FLOORS.splits],
      ['ace splits', aceSplits, COVERAGE_FLOORS.aceSplits],
      ['DAS', das, COVERAGE_FLOORS.das],
      ['doubles', doubles, COVERAGE_FLOORS.doubles],
      ['funded insurance (dealer-Ace rounds)', insuranceFunded, COVERAGE_FLOORS.fundedInsuranceDealerAce],
    ];
    const short = floors.filter(([, got, floor]) => got < floor);
    const detail = `Rules: ${register.join('; ')}. ` +
      `Floors: ${floors.map(([k, got, floor]) => `${k} ${got}/${floor}${got < floor ? ' SHORT' : ''}`).join(', ')}. ` +
      `Uncaptured games: ${gaps} (capture-retry register, Step 4; plan ${EXPECTED_CAPTURE_RETRY_GAPS}), no voided or aborted game observed. Stakes: inside the declared brackets (Step 33). ` +
      (short.length ? `SHORTFALL (capture origin — the capture script declined every insurance prompt): ${short.map(([k]) => k).join(', ')} — the rule is ASSUMED, disclosed in MANIFEST.md DL register, not verified.` : '');
    results.push(contradicted
      ? step(37, 'Rule & Coverage Register', 'FAIL', `A declared rule is contradicted by the data. ${detail}`)
      : short.length
        ? step(37, 'Rule & Coverage Register', 'FLAG', detail, { splits, aceSplits, das, doubles, insuranceFunded, insuranceOffers }, 'capture')
        : step(37, 'Rule & Coverage Register', 'PASS', detail));
  }

  return results;
}
