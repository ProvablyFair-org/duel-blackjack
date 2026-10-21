/**
 * Spec self-test — docs/ALGORITHM.md §5 vectors and properties, run against src/rng.ts.
 *
 * Written by the clean-room implementer together with src/rng.ts, from docs/ALGORITHM.md and the module
 * interface alone (never from Duel's code). Integrated 20 Oct 2026: the checks are unchanged; only the
 * import path, the mocha wrapper and the reporting (failures collected instead of printed) were adapted.
 */
import { createHash, randomBytes } from 'crypto';
import {
  CARDS, DECK_RANGE, MAX_FAIR, CHUNKS_PER_HASH, DEAL_ORDER,
  hmacSHA256, hmacSHA256WithKey, generateCardFromHash, generateCardIndexFromHash, drawWithCensus,
  getCard, getCardWithKey, getDeck, hashServerSeed,
  cardRank, cardSuit, cardColor, rankValue, parseCard, handValue, isBlackjack, isBust,
} from '../../src/rng';

import * as assert from 'assert';

const EXPECTED_CHECKS = 96;

function runSelftest(): { pass: number; total: number; failed: string[] } {
  let pass = 0;
  let total = 0;
  const failed: string[] = [];
  function check(name: string, ok: boolean, detail = ''): void {
    total++;
    if (ok) pass++;
    else failed.push(`${name}${detail ? '  ' + detail : ''}`);
  }
  function throws(fn: () => unknown): boolean {
    try { fn(); return false; } catch { return true; }
  }

  // ---- §5 test vectors: [k, first 4 digest bytes, u32 (null where the spec omits it), idx, card] ----
  type Row = [number, string, number | null, number, string];
  interface Vector { name: string; seed: string; commitment: string | null; client: string; nonce: number; rows: Row[] }

  const SEED_A = 'b6f2cbcd411eedbd53587902410f17f43e962f2e374e97ccbec24088debd0556';
  const COMMIT_A = '94c218c91df8997d4e7b1280687e90a3573c98739bd9220cd2fdd595699ef34f';

  const VECTORS: Vector[] = [
    { name: 'V1', seed: SEED_A, commitment: COMMIT_A, client: 'pf_Naa0pBEOuWmz6', nonce: 0, rows: [
      [0, '9fa6f6bf', 2678519487, 7, '3C'], [1, 'fd30ac97', 4247825559, 3, '2C'],
      [2, 'ad860917', 2911242519, 3, '2C'], [3, '6d2f341c', 1831810076, 44, 'KD'],
      [4, '893accec', 2302332140, 4, '3D'], [5, 'b28b9f1f', 2995494687, 3, '2C'],
      [6, '7be6b490', 2078717072, 16, '6D'], [7, '07dd5c83', 131947651, 43, 'QC'],
    ] },
    { name: 'V2', seed: SEED_A, commitment: COMMIT_A, client: 'pf_Naa0pBEOuWmz6', nonce: 26, rows: [
      [0, 'ea6eaf5a', null, 6, '3S'], [1, 'ca197c27', null, 15, '5C'], [2, 'ca81913f', null, 7, '3C'],
      [3, 'dd7a7fea', null, 14, '5S'], [4, 'd71a95a2', null, 2, '2S'], [5, 'd70b8278', null, 4, '3D'],
      [6, 'e671b131', null, 1, '2H'], [7, 'c9ea5146', null, 38, 'JS'], [8, 'b0f61703', null, 19, '6C'],
      [9, 'f2ba7937', null, 7, '3C'], [10, 'b7265d50', null, 44, 'KD'],
    ] },
    { name: 'V3', seed: '779a8530d053bd9a81d15c3bf2e685aafd999235e547ffb16ecefb3313848203',
      commitment: '5b1a5f07fb1a96326c9072261396521111caca101316eccd574124f5f4a12320',
      client: 'pf_2oHahABmWrqZW', nonce: 49, rows: [
      [0, '17651de1', 392502753, 45, 'KH'], [1, 'f2e9c929', 4075407657, 9, '4H'],
      [2, '42a545c1', 1118127553, 49, 'AH'], [3, 'b4f0515f', 3035648351, 47, 'KC'],
    ] },
    { name: 'V4', seed: SEED_A, commitment: COMMIT_A, client: 'pf_Naa0pBEOuWmz6', nonce: 37, rows: [
      [0, 'dae7703a', 3672600634, 14, '5S'], [1, 'd2c9d634', 3536442932, 48, 'AD'],
      [2, 'f4b8a8ad', 4105742509, 37, 'JH'], [3, '0b48371b', 189282075, 47, 'KC'],
    ] },
    { name: 'V5', seed: '99a6d624d830675a44fb4e725fe64c6f61d36cedf371c80f79eeba41c0c1ddad',
      commitment: 'e18f4b87c0d30b8c55827e21d14de004e1d527b2f35855568ef87c31915350c5',
      client: 'pf_MWIcFWH1ipUlx', nonce: 28, rows: [
      [0, '9395bf63', 2476064611, 7, '3C'], [1, 'fcdbfb75', 4242275189, 9, '4H'],
      [2, '030696fd', 50763517, 25, '8H'], [3, '13042a92', 319040146, 22, '7S'],
      [4, '99333e55', 2570272341, 13, '5H'], [5, 'b375b066', 3010834534, 6, '3S'],
      [6, 'da25ed2a', 3659918634, 34, '10S'],
    ] },
    { name: 'V6', seed: '5256f032e5b22d722ca97e261ba2fb9fa0d737d42da24fe22457fc6b37d41942',
      commitment: '869d43bde40281ca705b2593698a06976aa0e243911159b9d4295962864ecb9f',
      client: 'pfaudit_bj_seed05', nonce: 16, rows: [
      [0, '9aa9e97e', null, 50, 'AS'], [1, '37865028', null, 8, '4D'], [2, '709ff693', null, 51, 'AC'],
      [3, '4309079f', null, 43, 'QC'], [4, '9c68cb0c', null, 32, '10D'], [5, '1a2abd9d', null, 21, '7H'],
      [6, 'ea5c3ff1', null, 5, '3H'],
    ] },
  ];

  // §5 full digests for V1 k=0 and k=1.
  check('V1 full digest k=0', hmacSHA256(SEED_A, 'pf_Naa0pBEOuWmz6:0:0').toString('hex') ===
    '9fa6f6bfd79a0c761bf728f64cc0b389367f21e470ae118e7f2788d4a5351a5b');
  check('V1 full digest k=1', hmacSHA256(SEED_A, 'pf_Naa0pBEOuWmz6:0:1').toString('hex') ===
    'fd30ac9732b35170cd06b9c9fcd9fc52de1a257fd368bc22eb28e2ccaa18cebd');

  for (const v of VECTORS) {
    if (v.commitment !== null) {
      const got = hashServerSeed(v.seed);
      check(`${v.name} commitment`, got === v.commitment, got);
    }
    for (const [k, head, u32, idx, card] of v.rows) {
      const digest = hmacSHA256(v.seed, `${v.client}:${v.nonce}:${k}`);
      const gHead = digest.subarray(0, 4).toString('hex');
      const gU32 = digest.readUInt32BE(0);
      const gIdx = generateCardIndexFromHash(digest);
      const gCard = getCard(v.seed, v.client, v.nonce, k);
      const ok = gHead === head && (u32 === null || gU32 === u32) && gIdx === idx && gCard === card;
      check(`${v.name} k=${k}`, ok, `${gHead} ${gU32} idx ${gIdx} ${gCard}`);
    }
    const deck = getDeck(v.seed, v.client, v.nonce, v.rows.length);
    check(`${v.name} getDeck order`, deck.join(',') === v.rows.map((r) => r[4]).join(','), deck.join(' '));
  }

  // §5 hand totals stated in the vectors (helpers only; round play is not in this module).
  const hv = (c: string[]) => handValue(c).best;
  check('V1 player 16, dealer 22 bust', hv(['3C', '2C', '3D', '2C', '6D']) === 16 && isBust(['2C', 'KD', 'QC']));
  check('V2 hand1 17, hand2 12, dealer 13 then 23 bust',
    hv(['3S', '2S', '2H', 'JS']) === 17 && hv(['3C', '3D', '6C']) === 12 &&
    hv(['5C', '5S', '3C']) === 13 && isBust(['5C', '5S', '3C', 'KD']));
  check('V3 player natural, dealer 14', isBlackjack(['KH', 'AH']) && hv(['4H', 'KC']) === 14);
  check('V4 dealer natural, player 15', isBlackjack(['AD', 'KC']) && hv(['5S', 'JH']) === 15);
  check('V5 doubled hand 16, dealer 14 then 24 bust',
    hv(['3C', '8H', '5H']) === 16 && hv(['4H', '7S', '3S']) === 14 && isBust(['4H', '7S', '3S', '10S']));
  check('V6 hand1 21, hand2 soft 18, dealer 17',
    hv(['AS', '10D']) === 21 && hv(['AC', '7H']) === 18 && handValue(['AC', '7H']).isSoft &&
    hv(['4D', 'QC', '3H']) === 17);

  // ---- Constants (§2 Steps 2-4) ----
  check('DECK_RANGE = 52', DECK_RANGE === 52);
  check('MAX_FAIR = 4294967248', MAX_FAIR === 4294967248);
  check('CHUNKS_PER_HASH = 8', CHUNKS_PER_HASH === 8);
  check('CARDS: 52 distinct', CARDS.length === 52 && new Set(CARDS).size === 52);
  check('CARDS table anchors (0=2D 1=2H 2=2S 3=2C 4=3D 48=AD 51=AC)',
    CARDS[0] === '2D' && CARDS[1] === '2H' && CARDS[2] === '2S' && CARDS[3] === '2C' &&
    CARDS[4] === '3D' && CARDS[48] === 'AD' && CARDS[51] === 'AC');
  check('DEAL_ORDER = P1 0, up 1, P2 2, hole 3, first action 4',
    DEAL_ORDER.PLAYER_1 === 0 && DEAL_ORDER.DEALER_UP === 1 && DEAL_ORDER.PLAYER_2 === 2 &&
    DEAL_ORDER.DEALER_HOLE === 3 && DEAL_ORDER.FIRST_ACTION === 4);

  // ---- Bias report (§2 Step 2): 2^32 = 52 * 82,595,524 + 48 ----
  {
    const two32 = 2 ** 32;
    const q = Math.floor(two32 / 52);
    const r = two32 % 52;
    const plain = Array.from({ length: 52 }, (_, i) => q + (i < r ? 1 : 0));
    const sumPlain = plain.reduce((a, b) => a + b, 0);
    const maxDev = Math.max(...plain.map((n) => Math.abs(n / two32 - 1 / 52)));
    check('bias: 2^32 = 52 * 82595524 + 48', q === 82595524 && r === 48 && two32 - MAX_FAIR === 48);
    check('bias: plain mod gives 82595525 to idx 0-47, 82595524 to 48-51, sum 2^32',
      plain.slice(0, 48).every((n) => n === 82595525) && plain.slice(48).every((n) => n === 82595524) && sumPlain === two32);
    check('bias: plain-mod deviation from 1/52 below 2^-32', maxDev > 0 && maxDev < 2 ** -32, `max ${maxDev.toExponential(3)}`);
    check('bias: with rejection each idx has MAX_FAIR/52 preimages exactly', MAX_FAIR % 52 === 0 && MAX_FAIR / 52 === q);
  }

  // ---- Rejection behaviour on synthetic digests (§2 Step 2, §6 O1) ----
  function digestOf(chunks: number[]): Buffer {
    const b = Buffer.alloc(32);
    chunks.forEach((v, i) => b.writeUInt32BE(v, i * 4));
    return b;
  }
  {
    const d = digestOf([MAX_FAIR - 1]);
    const c = drawWithCensus(d);
    check('chunk MAX_FAIR-1 accepted -> idx 51 AC, 0 rejected', generateCardIndexFromHash(d) === 51 && c.card === 'AC' && c.rejected === 0);
  }
  {
    const d = digestOf([MAX_FAIR, 5]);
    const c = drawWithCensus(d);
    check('chunk == MAX_FAIR rejected, next chunk 5 -> 3H, 1 rejected', generateCardFromHash(d) === '3H' && c.card === '3H' && c.rejected === 1);
  }
  {
    const d = digestOf([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 52 * 3 + 2]);
    const c = drawWithCensus(d);
    check('7 rejected chunks, 8th accepted -> 2S, 7 rejected', c.card === '2S' && c.rejected === 7 && generateCardFromHash(d) === '2S');
  }
  {
    const d = digestOf(new Array(8).fill(0xffffffff));
    const c = drawWithCensus(d);
    check('all 8 chunks rejected -> census null/8, draw throws',
      c.card === null && c.rejected === 8 && throws(() => generateCardFromHash(d)) && throws(() => generateCardIndexFromHash(d)));
  }

  // ---- Range and census consistency over many real digests ----
  {
    const key = Buffer.from(SEED_A, 'hex');
    const counts = new Array(52).fill(0);
    let inRange = true;
    let consistent = true;
    let rejectedTotal = 0;
    const N = 52000;
    for (let k = 0; k < N; k++) {
      const d = hmacSHA256WithKey(key, `range-test:${k % 1000}:${Math.floor(k / 1000)}`);
      const i = generateCardIndexFromHash(d);
      const c = drawWithCensus(d);
      if (!(Number.isInteger(i) && i >= 0 && i < 52)) inRange = false;
      if (c.card !== CARDS[i] || generateCardFromHash(d) !== CARDS[i]) consistent = false;
      rejectedTotal += c.rejected;
      counts[i]++;
    }
    check(`range: ${N} indices all in 0..51`, inRange);
    check('census card == generateCardFromHash == CARDS[index] on every draw', consistent, `rejected chunks ${rejectedTotal}`);
    check('range: all 52 indices seen', counts.every((n) => n > 0), `min ${Math.min(...counts)} max ${Math.max(...counts)}`);
  }

  // ---- Commitment (hash check true / false) ----
  check('hash check true: V1 seed -> V1 commitment', hashServerSeed(SEED_A) === COMMIT_A);
  check('hash check false: V3 seed vs V1 commitment', hashServerSeed(VECTORS[2].seed) !== COMMIT_A);
  check('hash check false: SHA-256 of ASCII hex text is not the commitment',
    createHash('sha256').update(SEED_A, 'utf8').digest('hex') !== COMMIT_A);
  check('hash check false: one flipped seed char',
    hashServerSeed('c' + SEED_A.slice(1)) !== COMMIT_A);
  check('commitment is 64 lowercase hex', /^[0-9a-f]{64}$/.test(hashServerSeed(SEED_A)));

  // ---- Keyed vs unkeyed APIs agree; input validation ----
  {
    const key = Buffer.from(SEED_A, 'hex');
    check('hmacSHA256 == hmacSHA256WithKey', hmacSHA256(SEED_A, 'x:1:2').equals(hmacSHA256WithKey(key, 'x:1:2')));
    check('getCard == getCardWithKey (V2 k=7)', getCard(SEED_A, 'pf_Naa0pBEOuWmz6', 26, 7) === getCardWithKey(key, 'pf_Naa0pBEOuWmz6', 26, 7));
    check('getDeck default length 52', getDeck(SEED_A, 'pf_Naa0pBEOuWmz6', 0).length === 52);
    check('invalid inputs throw (non-hex seed, short seed, negative nonce, fractional cursor)',
      throws(() => hashServerSeed('zz'.repeat(32))) && throws(() => getCard('ab', 'c', 0, 0)) &&
      throws(() => getCard(SEED_A, 'c', -1, 0)) && throws(() => getCard(SEED_A, 'c', 0, 1.5)));
  }

  // ---- Card helpers ----
  check('cardRank/cardSuit("10S")', cardRank('10S') === '10' && cardSuit('10S') === 'S');
  check('cardColor D/H red, S/C black',
    cardColor('2D') === 'red' && cardColor('AH') === 'red' && cardColor('KS') === 'black' && cardColor('9C') === 'black');
  check('rankValue A=11 K=10 10=10 7=7', rankValue('A') === 11 && rankValue('K') === 10 && rankValue('10') === 10 && rankValue('7') === 7);
  check('parseCard("AH")', JSON.stringify(parseCard('AH')) === '{"rank":"A","suit":"H"}' && throws(() => parseCard('1X')));
  {
    const a = handValue(['AS', 'AH', '9C']);
    const b = handValue(['AS', '5D', 'KC']);
    const c = handValue(['AS', '6D']);
    check('handValue A,A,9 = hard 11 soft 21 best 21 soft', a.hard === 11 && a.soft === 21 && a.best === 21 && a.isSoft);
    check('handValue A,5,K = hard 16 best 16 not soft', b.hard === 16 && b.soft === 16 && b.best === 16 && !b.isSoft);
    check('handValue A,6 = soft 17', c.hard === 7 && c.soft === 17 && c.best === 17 && c.isSoft);
  }
  check('isBlackjack: two-card 21 only', isBlackjack(['AS', 'QD']) && !isBlackjack(['7S', '7D', '7C']) && !isBlackjack(['AS', '9D']));
  check('isBust: hard > 21', isBust(['KS', 'QD', '2C']) && !isBust(['AS', 'AD', 'KC', '9H']) && !isBust(['KS', 'AD', 'KC']));

  return { pass, total, failed };
}

describe('Spec self-test — src/rng.ts against docs/ALGORITHM.md (clean-room rebuild)', function () {
  this.timeout(300_000);
  it(`all ${EXPECTED_CHECKS} spec vector and property checks pass`, () => {
    const r = runSelftest();
    assert.deepStrictEqual(r.failed, []);
    assert.strictEqual(r.total, EXPECTED_CHECKS);
    assert.strictEqual(r.pass, EXPECTED_CHECKS);
  });
});
