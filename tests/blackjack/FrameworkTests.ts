/**
 * Framework 1.0 unit tests (2026-09-24) — fixed vectors for the code the new and rewritten steps
 * rely on: the rejection branch the capture never reached (Step 35), the declared split draw order
 * and the replay grammar (Steps 5/22/36), settlement from the cards (Step 7), exact money (Step 7),
 * the engine's average wager (Step 16) and the exact side-bet edges (Step 16).
 */
import { expect } from 'chai';
import { CARDS, MAX_FAIR, drawWithCensus, generateCardFromHash } from '../../src/rng';
import { declaredOrder, replayRound, settleRound } from '../../src/round';
import { toUnits, toRational, mulUnits, exactEquals } from '../../src/money';
import { computeOptimalRTP, computeAverageWager } from '../../src/optimal-play';
import { perfectPairsExact, twentyOnePlus3Exact } from '../../src/sidebet-edges';
import { RULES, RULES_IN_EFFECT, rulesInEffect, ORACLE_RTP, ORACLE_TOL, oracleValue } from '../../src/config';
import { execFileSync } from 'child_process';
import * as path from 'path';

const chunks = (...v: number[]): Buffer => { const b = Buffer.alloc(32); v.forEach((x, i) => b.writeUInt32BE(x >>> 0, 4 * i)); return b; };

describe('Framework — rejection branch (unwitnessed in the capture, exercised here)', () => {
  it('a first chunk >= MAX_FAIR is rejected and the next chunk decides the card', () => {
    const h = chunks(MAX_FAIR, 53);                  // 53 mod 52 = 1 → CARDS[1]
    expect(drawWithCensus(h)).to.deep.equal({ card: CARDS[1], rejected: 1 });
    expect(generateCardFromHash(h)).to.equal(CARDS[1]);
  });
  it('MAX_FAIR − 1 is accepted (the boundary belongs to the fair range)', () => {
    expect(drawWithCensus(chunks(MAX_FAIR - 1))).to.deep.equal({ card: CARDS[(MAX_FAIR - 1) % 52], rejected: 0 });
  });
  it('all eight chunks rejected: census reports null, the canonical draw throws', () => {
    const h = chunks(...Array(8).fill(0xffffffff));
    expect(drawWithCensus(h)).to.deep.equal({ card: null, rejected: 8 });
    expect(() => generateCardFromHash(h)).to.throw();
  });
});

describe('Framework — declared split draw order and replay', () => {
  // cursor:            0     1     2     3      4     5     6     7     8
  const stream = ['8H', '6C', '8D', '10S', '3C', '2D', 'KC', '9H', '5S'];
  const draw = (c: number) => stream[c];
  it('replays P1 D1 P2 D2 · H1 second · H2 second · H1 plays · H2 plays · dealer', () => {
    const r = replayRound('', '', 0, ['split', 'double', 'hit', 'stand'], draw);
    expect(r.violations).to.deep.equal([]);
    expect(r.hands.map(h => h.cards)).to.deep.equal([['8H', '3C', 'KC'], ['8D', '2D', '9H']]);
    expect(r.hands[0].doubled).to.equal(true);
    expect(r.dealer).to.deep.equal(['6C', '10S', '5S']);   // 16 → the dealer draws cursor 8 and stands on 21
  });
  it('declaredOrder lays the served split round out in the same cursor order', () => {
    const o = declaredOrder({ playerDeal: ['8H', '8D'], dealerUp: '6C', dealerFinal: ['6C', '10S', '5S'],
      hands: [{ cards: ['8H', '3C', 'KC'], doubled: true, result: null, type: 'main' }, { cards: ['8D', '2D', '9H'], doubled: false, result: null, type: 'split' }] });
    expect(o).to.deep.equal({ seq: ['8H', '6C', '8D', '10S', '3C', '2D', 'KC', '9H', '5S'] });
  });
  it('grammar: a token after the round is over, and double on three cards, are violations', () => {
    expect(replayRound('', '', 0, ['stand', 'hit'], draw).violations.length).to.be.greaterThan(0);
    expect(replayRound('', '', 0, ['hit', 'double'], (c) => ['2H', '6C', '3D', '10S', '4C', '5C', '9C', '9D'][c]).violations.join())
      .to.contain('double on a 3-card hand');
  });
});

describe('Framework — settlement from the cards', () => {
  it('natural pays 2.5, natural vs natural pushes, dealer natural takes the stake', () => {
    expect(settleRound([{ cards: ['AS', 'KD'], doubled: false }], ['9C', '7D'], false)).to.deep.equal([{ result: 'blackjack', halfStakes: 5n }]);
    expect(settleRound([{ cards: ['AS', 'KD'], doubled: false }], ['AC', 'QD'], false)).to.deep.equal([{ result: 'push', halfStakes: 2n }]);
    expect(settleRound([{ cards: ['9S', 'KD'], doubled: false }], ['AC', 'QD'], false)).to.deep.equal([{ result: 'lose', halfStakes: 0n }]);
  });
  it('a two-card 21 after a split is a total, not a natural (1:1); a doubled win is 4x; a bust is 0', () => {
    const st = settleRound([{ cards: ['AS', 'KD'], doubled: false }, { cards: ['9H', '5D', '9C'], doubled: true }], ['10C', '8D'], true);
    expect(st).to.deep.equal([{ result: 'win', halfStakes: 4n }, { result: 'bust', halfStakes: 0n }]);
    expect(settleRound([{ cards: ['5S', '6D', 'KC'], doubled: true }], ['10C', '8D'], false)).to.deep.equal([{ result: 'win', halfStakes: 8n }]);
  });
});

describe('Framework — exact money on the 1e-18 grid', () => {
  it('parses on-grid amounts and rejects off-grid ones', () => {
    expect(toUnits('0.010000000000000000')).to.equal(10n ** 16n);
    expect(toUnits('0.11')).to.equal(11n * 10n ** 16n);
    expect(toUnits('0.0100000000000000000')).to.equal(null);   // 19 decimals
    expect(toUnits('-1')).to.equal(null);
    expect(toUnits('1e-3')).to.equal(null);
  });
  it('121.2307692 × 0.01 is exactly 1.212307692 — no float residue', () => {
    expect(exactEquals(mulUnits(toUnits('0.01')!, toRational(121.2307692)!), toUnits('1.212307692')!)).to.equal(true);
    expect(exactEquals(mulUnits(toUnits('0.01')!, toRational(121.2307692)!), toUnits('1.212307693')!)).to.equal(false);
  });
});

describe('Framework — engine conventions and exact side-bet edges', () => {
  it('average wager of the optimal strategy is between 1 and 2 with no action ties; per-total RTP follows', () => {
    const r = computeOptimalRTP(), w = computeAverageWager();
    expect(w.ties).to.equal(0);
    expect(w.averageWager).to.be.greaterThan(1).and.lessThan(1.2);
    expect(1 - r.edge / w.averageWager).to.be.greaterThan(r.rtp);
  });
  it('Perfect Pairs edge is exactly 0; 21+3 edge is exactly 16/1406080000000', () => {
    const pp = perfectPairsExact(), t3 = twentyOnePlus3Exact();
    expect(pp.edgeNum).to.equal(0n);
    expect(pp.counts).to.deep.equal({ perfect_pair: 52, colored_pair: 52, mixed_pair: 104 });
    expect(`${t3.edgeNum}/${t3.edgeDen}`).to.equal('16/1406080000000');
    expect(t3.counts).to.deep.equal({ suited_trips: 52, three_kind: 780, flush: 8448, straight_flush: 288, straight: 4320 });
  });
});

describe('Framework — the rule set is single-sourced (profile BLACKJACK-26)', () => {
  it('RULES_IN_EFFECT is the derivation of RULES: S17, DAS, one card to split aces, a natural = 5 half-stakes', () => {
    expect(rulesInEffect(RULES)).to.deep.equal({ ...RULES_IN_EFFECT });
    expect(RULES_IN_EFFECT).to.include({ soft17: 'stand', das: true, splitAcesOneCard: true, peek: true, naturalGross: 2.5 });
    expect(RULES_IN_EFFECT.naturalHalfStakes).to.equal(5n);
  });
  it('a rule the replay, settlement and engine cannot play throws instead of being played as the old rule', () => {
    for (const bad of [{ maxSplits: 2 }, { surrender: true }, { deck: '8-deck' }, { peek: false }, { naturalPays: '6:5' }, { splitPairing: 'value' }]) {
      expect(() => rulesInEffect({ ...RULES, ...bad } as any)).to.throw(/cannot play/);
    }
  });
  it('the engine reads the rule: its defaults are RULES, and the other soft-17 rule moves the figure', () => {
    const d = computeOptimalRTP();
    expect([d.s17, d.das]).to.deep.equal([RULES.dealerSoft17, RULES.das]);
    expect(computeOptimalRTP('hit').rtp).to.be.lessThan(d.rtp - 1e-3);
  });
});

describe('Framework — exact-rational oracle (anchor/oracle.py, profile BLACKJACK-18)', () => {
  let out = '';
  before(function () {
    try { out = execFileSync('python3', [path.join(__dirname, '..', '..', 'anchor', 'oracle.py')], { encoding: 'utf-8' }); }
    catch { this.skip(); }   // no python3 on this machine: the pinned printout is still scored by verify Step 16
  });
  it('re-running the oracle prints exactly the pinned S17 and H17 fractions', () => {
    const got = [...out.matchAll(/exact = (\d+)\/(\d+)/g)].map(m => [m[1], m[2]]);
    expect(got).to.deep.equal([[...ORACLE_RTP.stand], [...ORACLE_RTP.hit]]);
  });
  it('the engine equals the oracle within 1e-12 under S17 and under H17', () => {
    expect(Math.abs(computeOptimalRTP('stand').rtp - oracleValue(ORACLE_RTP.stand))).to.be.at.most(ORACLE_TOL);
    expect(Math.abs(computeOptimalRTP('hit').rtp - oracleValue(ORACLE_RTP.hit))).to.be.at.most(ORACLE_TOL);
  });
  it('under the 13-rank model a 10-10 split is never chosen, so folding ten-values into one rank costs the engine nothing', () => {
    expect((out.match(/against up-cards: none/g) || []).length).to.equal(2);
  });
});

describe('Framework — the operator\'s own Verify-tab code, executed unmodified (profile BLACKJACK-09)', () => {
  // duel.com → Provably Fair → Verify (Blackjack) code panel, copied verbatim 2026-09-25 (src/operator-verifier.ts)
  const { runOperatorVerifier, checkOperatorCites, OPERATOR_HASH_VECTORS, OPERATOR_VERIFIER_PINS, OPERATOR_VERIFIER_FILE } =
    require('../../src/operator-verifier') as typeof import('../../src/operator-verifier');
  const { getCard, getDeck } = require('../../src/rng') as typeof import('../../src/rng');
  const { loadDataset, buildSeedMap, EXPECTED_HANDS } = require('../../src/loader') as typeof import('../../src/loader');
  const { servedRound } = require('../../src/round') as typeof import('../../src/round');
  const KNOWN = { id: 'known', serverSeed: 'b6f2cbcd411eedbd53587902410f17f43e962f2e374e97ccbec24088debd0556', clientSeed: 'pf_Naa0pBEOuWmz6', nonce: 0 };
  let run: ReturnType<typeof runOperatorVerifier>;
  let ds: ReturnType<typeof loadDataset>;
  let seedMap: Map<string, string>;
  before(() => {
    ds = loadDataset();
    seedMap = buildSeedMap(ds.bets, ds.seeds);
    const rounds = [KNOWN, ...ds.bets.map(b => ({ id: b.id, serverSeed: seedMap.get(b.server_seed_hashed) ?? '', clientSeed: b.client_seed, nonce: b.nonce }))];
    run = runOperatorVerifier(rounds, OPERATOR_HASH_VECTORS.map(v => v.hash));
  });
  it('the vendored operator file and its runner hash to their pins, and the code ran', () => {
    expect(run.files.map(f => f.match)).to.deep.equal([true, true]);
    expect(run.files[0].file).to.equal(OPERATOR_VERIFIER_FILE);
    expect(run.files[0].actual).to.equal(OPERATOR_VERIFIER_PINS[OPERATOR_VERIFIER_FILE]);
    expect(run.error).to.equal(null);
  });
  it('every operator line src/rng.ts cites carries the quoted text verbatim', () => {
    const c = checkOperatorCites();
    expect(c.bad).to.deep.equal([]);
    expect(c.checked).to.be.greaterThan(0);
  });
  it('the operator CARDS table is src/rng.ts CARDS', () => {
    expect(run.cardsTable).to.deep.equal(CARDS);
  });
  it('fixed vector: the known captured hand (nonce 0) — cursors 0-2 are 3C 2C 2C and all 50 equal src/rng.ts', () => {
    const got = run.cards!.get('known')!;
    expect(got.slice(0, 3)).to.deep.equal(['3C', '2C', '2C']);
    expect(got).to.deep.equal(getDeck(KNOWN.serverSeed, KNOWN.clientSeed, 0, 50));
  });
  it('fixed hash vectors: rejection at MAX_FAIR, acceptance at MAX_FAIR − 1, seven rejections, all rejected, big-endian read', () => {
    OPERATOR_HASH_VECTORS.forEach((v, i) => {
      const h = run.hashCards[i];
      expect(h.hash, v.id).to.equal(v.hash);
      expect(h.card, `${v.id} operator`).to.equal(v.card);
      if (v.card === null) {
        expect(h.error, `${v.id} operator throws`).to.be.a('string');
        expect(() => generateCardFromHash(Buffer.from(v.hash, 'hex')), `${v.id} src/rng.ts throws`).to.throw();
      } else {
        expect(generateCardFromHash(Buffer.from(v.hash, 'hex')), `${v.id} src/rng.ts`).to.equal(v.card);
      }
    });
  });
  it('every captured hand: the operator code reproduces the served cards in the declared order and equals src/rng.ts on all 50 cursors', () => {
    let hands = 0, cursors = 0, served = 0;
    const bad: string[] = [];
    for (const b of ds.bets) {
      const seed = seedMap.get(b.server_seed_hashed)!;
      const got = run.cards!.get(String(b.id));
      const s = servedRound(b);
      const o = s ? declaredOrder(s) : { error: 'unreadable' };
      if (!got || got.length !== 50 || 'error' in o) { bad.push(String(b.id)); continue; }
      for (let c = 0; c < 50; c++) { cursors++; if (got[c] !== getCard(seed, b.client_seed, b.nonce, c)) bad.push(`${b.id}@${c}`); }
      o.seq.forEach((card, c) => { served++; if (got[c] !== card) bad.push(`${b.id} served@${c}`); });
      hands++;
    }
    expect(bad.slice(0, 5)).to.deep.equal([]);
    expect(hands).to.equal(EXPECTED_HANDS);
    expect(cursors).to.equal(EXPECTED_HANDS * 50);
    expect(served).to.be.greaterThan(4 * EXPECTED_HANDS - 1);
  });
});
