/**
 * Step 38: Player-Verifier Parity (profile BLACKJACK-24).
 *
 * Two ProvablyFair.org verifiers a player can use are PINNED by SHA-256 and EXECUTED — not re-typed —
 * on every one of the 6,000 captured rounds, and each must agree with this package's recomputation:
 *
 *   (1) DOCS SITE — VerifyBets games/blackjack/derive.js + lib/hmac-sha256.js (src/site-verifier.ts).
 *       Its deriveBlackjackSync replays the recorded actions itself; its hands (cards, outcome,
 *       doubled, gross payout per unit stake), dealer hand and side-bet multipliers must equal the
 *       package's (src/round.ts recomputedHands + settleRound; src/config.ts paytable).
 *   (2) LIVE SITE — www.provablyfair.org/verify-bets, the deployed Next.js bundle
 *       (src/live-site-verifier.ts). Its Duel Blackjack verifier prints the first 24 cursors of a
 *       round; every one must equal src/rng.ts getCard at that cursor, and every round's
 *       declared-order card sequence must fit inside those 24 (a round needing more is reported).
 *
 *   (3) OPERATOR — Duel's own Verify-tab code for Blackjack (duel.com → Provably Fair → Verify, copied
 *       verbatim 2026-09-25; src/operator-verifier.ts, profile BLACKJACK-09). Executed unmodified on
 *       every round: all 50 cursors its validateBlackjackResult returns must equal src/rng.ts getCard,
 *       and the served cards in the declared order must equal its first cursors. Its CARDS table must
 *       equal src/rng.ts CARDS, its generateInfiniteDeckCard must give the expected card (or throw) on
 *       each fixed hash vector (the rejection branch no captured round reaches), it must print only
 *       its own empty-input message, and every operator line src/rng.ts cites must carry the quoted text.
 *
 * A vendored file that does not hash to its pin FAILs before anything runs.
 * scripts/check-site-verifier.mjs compares a docs-site checkout (or --live, the live site) with the pins.
 */

import { getCard, CARDS, generateCardFromHash } from '../../src/rng';
import { runOperatorVerifier, checkOperatorCites, OPERATOR_HASH_VECTORS, OPERATOR_EXPECTED_LOGS,
  OPERATOR_VERIFIER_PROVENANCE } from '../../src/operator-verifier';
import { classifyPerfectPairs, classifyTwentyOnePlus3 } from '../../src/sidebets';
import { PP_PAYTABLE, T3_PAYTABLE, PP_KEY, T3_KEY } from '../../src/config';
import { toUnits } from '../../src/money';
import { servedRound, declaredOrder, recomputedHands, settleRound } from '../../src/round';
import { loadSiteVerifier } from '../../src/site-verifier';
import { runLiveSiteVerifier } from '../../src/live-site-verifier';
import { EXPECTED_HANDS } from '../../src/loader';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const problems: string[] = [];

  // ── (1) docs-site derive.js ────────────────────────────────────────────────
  const site = loadSiteVerifier();
  let docsAgree = 0, docsDiffer = 0;
  if (!site.deriveBlackjack) problems.push(`docs-site verifier: ${site.error}`);
  else {
    for (const b of ctx.bets) {
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      const s = servedRound(b);
      if (!seed || !s || 'error' in declaredOrder(s)) { docsDiffer++; continue; }
      const sb = b.deal?.blackjack?.side_bet_results ?? {};
      const placed = (x: any) => !!x && (toUnits(x.amount_placed) ?? 0n) > 0n;
      let d;
      try {
        d = site.deriveBlackjack({ serverSeed: seed, clientSeed: b.client_seed, nonce: b.nonce, actions: b.actions,
          sideBets: { perfectPairs: placed(sb.side_perfect_pairs), twentyOnePlus3: placed(sb.side_21_plus_3) } });
      } catch (e) { docsDiffer++; if (problems.length < 4) problems.push(`docs-site threw on bet ${b.id}: ${(e as Error).message}`); continue; }
      const rc = recomputedHands(s, seed, b.client_seed, b.nonce);
      const st = settleRound(rc.hands, rc.dealer, s.hands.length > 1);
      const p1 = getCard(seed, b.client_seed, b.nonce, 0), up = getCard(seed, b.client_seed, b.nonce, 1), p2 = getCard(seed, b.client_seed, b.nonce, 2);
      const ppCat = classifyPerfectPairs(p1, p2), t3Cat = classifyTwentyOnePlus3(p1, p2, up);
      const ppWant = placed(sb.side_perfect_pairs) ? (ppCat ? Number(PP_PAYTABLE[PP_KEY[ppCat]]) : 0) : 0;
      const t3Want = placed(sb.side_21_plus_3) ? (t3Cat ? Number(T3_PAYTABLE[T3_KEY[t3Cat]]) : 0) : 0;
      const same = d.hands.length === rc.hands.length
        && d.hands.every((h, i) => h.cards.join() === rc.hands[i].cards.join() && h.outcome === st[i].result
          && h.doubled === rc.hands[i].doubled && h.payout * 2 === Number(st[i].halfStakes))
        && d.dealer.cards.join() === rc.dealer.join()
        && d.sideBets.perfectPairs.multiplier === ppWant && d.sideBets.twentyOnePlus3.multiplier === t3Want;
      if (same) docsAgree++;
      else { docsDiffer++; if (problems.length < 4) problems.push(`docs-site disagrees on bet ${b.id}`); }
    }
  }

  // ── (2) live www.provablyfair.org bundle ───────────────────────────────────
  const rounds = ctx.bets.map(b => ({ id: b.id, serverSeed: ctx.seedMap.get(b.server_seed_hashed) ?? '', clientSeed: b.client_seed, nonce: b.nonce }));
  const live = runLiveSiteVerifier('Duel.com', rounds);
  let liveAgree = 0, liveDiffer = 0, beyond24 = 0, liveCursors = 0;
  if (!live.cursors) problems.push(`live-site verifier: ${live.error}`);
  else {
    for (const b of ctx.bets) {
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      const got = live.cursors.get(String(b.id));
      const s = servedRound(b);
      const o = s ? declaredOrder(s) : { error: 'unreadable' };
      if (!seed || !got || 'error' in o) { liveDiffer++; continue; }
      if (o.seq.length > got.length) beyond24++;
      const ok = got.every((card, c) => card === getCard(seed, b.client_seed, b.nonce, c))
        && o.seq.slice(0, got.length).every((card, c) => card === got[c]);
      if (ok) { liveAgree++; liveCursors += got.length; }
      else { liveDiffer++; if (problems.length < 4) problems.push(`live site disagrees on bet ${b.id}`); }
    }
  }

  // ── (3) the operator's own Verify-tab code ────────────────────────────────
  const OP_CURSORS = 50;
  const op = runOperatorVerifier(rounds, OPERATOR_HASH_VECTORS.map(v => v.hash));
  let opRounds = 0, opRoundsDiffer = 0, opCursors = 0, opCursorsDiffer = 0, opServed = 0, opServedDiffer = 0;
  let vecOk = 0;
  const cites = checkOperatorCites();
  const logsOk = op.logs.length === OPERATOR_EXPECTED_LOGS.length && op.logs.every((l, i) => l === OPERATOR_EXPECTED_LOGS[i]);
  const tableOk = op.cardsTable.length === CARDS.length && op.cardsTable.every((c, i) => c === CARDS[i]);
  if (!op.cards) problems.push(`operator Verify-tab code: ${op.error}`);
  else {
    if (!logsOk) problems.push(`operator code printed ${JSON.stringify(op.logs).slice(0, 200)}`);
    if (!tableOk) problems.push('operator CARDS table differs from src/rng.ts CARDS');
    for (const b of ctx.bets) {
      const seed = ctx.seedMap.get(b.server_seed_hashed);
      const got = op.cards.get(String(b.id));
      const s = servedRound(b);
      const o = s ? declaredOrder(s) : { error: 'unreadable' };
      if (!seed || !got || got.length !== OP_CURSORS || 'error' in o) {
        opRoundsDiffer++; if (problems.length < 6) problems.push(`operator code gave no 50-card list for bet ${b.id}`); continue;
      }
      let roundOk = true;
      for (let c = 0; c < OP_CURSORS; c++) {
        opCursors++;
        if (got[c] !== getCard(seed, b.client_seed, b.nonce, c)) {
          opCursorsDiffer++; roundOk = false;
          if (problems.length < 6) problems.push(`operator code != src/rng.ts on bet ${b.id} cursor ${c}: ${got[c]} vs ${getCard(seed, b.client_seed, b.nonce, c)}`);
        }
      }
      o.seq.forEach((card, c) => {
        opServed++;
        if (got[c] !== card) {
          opServedDiffer++; roundOk = false;
          if (problems.length < 6) problems.push(`operator code != served card on bet ${b.id} cursor ${c}: ${got[c]} vs ${card}`);
        }
      });
      if (roundOk) opRounds++; else opRoundsDiffer++;
    }
    OPERATOR_HASH_VECTORS.forEach((v, i) => {
      const h = op.hashCards[i];
      let mine: string | null;
      try { mine = generateCardFromHash(Buffer.from(v.hash, 'hex')); } catch { mine = null; }
      if (h && h.hash === v.hash && h.card === v.card && mine === v.card && (v.card !== null || h.error !== null)) vecOk++;
      else if (problems.length < 6) problems.push(`hash vector ${v.id}: operator ${h?.card ?? `threw (${h?.error})`}, src/rng.ts ${mine ?? 'threw'}, expected ${v.card ?? 'throw'}`);
    });
  }
  if (cites.bad.length) problems.push(`src/rng.ts operator citations: ${cites.bad.slice(0, 2).join('; ')}`);
  const opOk = !!op.cards && op.hashesMatch && logsOk && tableOk && opRounds === EXPECTED_HANDS && opRoundsDiffer === 0
    && opCursors === EXPECTED_HANDS * OP_CURSORS && opCursorsDiffer === 0 && opServedDiffer === 0 && opServed > 0
    && vecOk === OPERATOR_HASH_VECTORS.length && cites.bad.length === 0 && cites.checked > 0;

  const ok = problems.length === 0 && docsAgree === EXPECTED_HANDS && liveAgree === EXPECTED_HANDS && beyond24 === 0
    && site.hashesMatch && live.hashesMatch && opOk;
  return [step(38, 'Player-Verifier Parity (docs site + live site)',
    ok ? 'PASS' : 'FAIL',
    `Docs-site verifier (VerifyBets games/blackjack/derive.js ${site.files[0]?.actual?.substring(0, 8) ?? 'absent'}…, lib/hmac-sha256.js ${site.files[1]?.actual?.substring(0, 8) ?? 'absent'}…; pins ${site.hashesMatch ? 'match' : 'DO NOT match'}) executed on every round, replaying the recorded actions itself: ` +
    `${docsAgree}/${EXPECTED_HANDS} agree with this package on every hand's cards, outcome, doubled flag and gross return, the dealer hand and both side-bet multipliers (${docsDiffer} differ). ` +
    `Live www.provablyfair.org/verify-bets bundle (3 chunks + runner, pins ${live.hashesMatch ? 'match' : 'DO NOT match'}; ${live.standIns.length} rendering modules stood in, none in the verifier's closure) executed on every round: ` +
    `${liveAgree}/${EXPECTED_HANDS} rounds, the 24 cursors it prints (${liveCursors} cards) equal src/rng.ts and the served cards in the declared order (${liveDiffer} differ; ${beyond24} rounds need more than the 24 cursors the page prints). ` +
    `Duel's own Verify-tab code (${OPERATOR_VERIFIER_PROVENANCE.savedAs} ${op.files[0]?.actual?.substring(0, 8) ?? 'absent'}…, copied ${OPERATOR_VERIFIER_PROVENANCE.copiedOn}; pins ${op.hashesMatch ? 'match' : 'DO NOT match'}) ` +
    (op.cards
      ? `executed unmodified on every round: ${opRounds}/${EXPECTED_HANDS} rounds agree — ${opCursors - opCursorsDiffer}/${EXPECTED_HANDS * OP_CURSORS} cursors equal src/rng.ts (${opCursorsDiffer} differ), ${opServed - opServedDiffer}/${opServed} served cards in the declared order equal its cursors (${opServedDiffer} differ); ` +
        `CARDS table ${tableOk ? 'equal' : 'DIFFERS'}; fixed hash vectors ${vecOk}/${OPERATOR_HASH_VECTORS.length} (rejection branch, all-rejected throw, big-endian read); `
      : `NOT executed — 0/${EXPECTED_HANDS} rounds checked; `) +
    `operator lines cited by src/rng.ts ${cites.checked - cites.bad.length}/${cites.checked} verbatim.` +
    (problems.length ? ` Problems: ${problems.join('; ')}` : ''),
    { docsAgree, docsDiffer, liveAgree, liveDiffer, beyond24, liveCursors,
      operatorRoundsAgree: opRounds, operatorRoundsDiffer: opRoundsDiffer, operatorCursors: opCursors, operatorCursorsDiffer: opCursorsDiffer,
      operatorServedCards: opServed, operatorServedDiffer: opServedDiffer, operatorVectorsOk: vecOk, operatorCitesChecked: cites.checked,
      operatorCitesBad: cites.bad.length })];
}
