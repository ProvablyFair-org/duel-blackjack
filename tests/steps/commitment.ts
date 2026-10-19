/**
 * Steps 1–4: Cryptographic commitment verification
 */

import { hashServerSeed } from '../../src/rng';
import { EXPECTED_EPOCHS, EXPECTED_EPOCH_SIZE, EXPECTED_CAPTURE_RETRY_GAPS, EXPECTED_SEEDS, NONCE_BASE, DECLARED_CAPTURE_RETRY_GAPS, GAP_CLOCK_EVIDENCE_S } from '../../src/loader';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 1: Seed Hash Integrity ─────────────────────────────────────────────
  // BOUND TO THE POPULATION. This step used to loop over ctx.seedMap alone, so a dataset whose
  // seeds were all unrevealed produced an empty map, 0/0 verified, 0 failures — PASS with zero
  // coverage. It now asserts coverage from both sides: every bet's committed hash must have a
  // revealed seed that hashes to it, the bet-bearing hashes must number EXPECTED_EPOCHS, and every
  // seed record that carries a seed must carry the right one (buildSeedMap skips a record whose
  // hash the bets already supplied, so a wrong seed there was never looked at). The serverSeed on
  // a seed record was attached after the capture from Duel's transaction records, not recorded
  // with the rotation response (MANIFEST.md, Dataset and capture).
  {
    let verified = 0, failed = 0;
    for (const [hash, seed] of ctx.seedMap) {
      if (hashServerSeed(seed) === hash) verified++;
      else failed++;
    }
    const betHashes = new Set(ctx.bets.map(b => b.server_seed_hashed));
    const betHashesUnrevealed = [...betHashes].filter(h => !ctx.seedMap.has(h)).length;
    let recordsRevealed = 0, recordsBad = 0;
    for (const s of ctx.seeds) {
      if (!s.seed.serverSeed) continue;
      recordsRevealed++;
      if (hashServerSeed(s.seed.serverSeed) !== s.seed.serverSeedHashed) recordsBad++;
    }
    // EQUALITY WITH THE CODE CONSTANT, not ">=": the number of revealed seeds checked must be exactly
    // the audited population EXPECTED_EPOCHS (src/loader.ts), never a count read from the dataset.
    const ok = failed === 0 && recordsBad === 0 && betHashesUnrevealed === 0
      && betHashes.size === EXPECTED_EPOCHS && verified === EXPECTED_EPOCHS && ctx.seedMap.size === EXPECTED_EPOCHS;
    results.push(step(1, 'Seed Hash Integrity',
      ok ? 'PASS' : 'FAIL',
      `${verified}/${EXPECTED_EPOCHS} revealed seeds (population from src/loader.ts; ${ctx.seedMap.size} in the dataset): SHA-256(hex_decode(serverSeed)) matches commitment, ${failed} failures. ` +
      `Coverage: ${betHashes.size - betHashesUnrevealed}/${betHashes.size} bet-bearing commitments have a revealed seed ` +
      `(${EXPECTED_EPOCHS} expected, ${betHashesUnrevealed} unrevealed). ` +
      `Seed records carrying a seed (attached after the capture from the transaction records): ${recordsRevealed}, ${recordsBad} carry a seed that does not hash to the record's commitment.`
    ));
  }

  // ── Step 2: Commitment Linkage ──────────────────────────────────────────────
  // Recomputed from the RAW rotation fields (no capture-script boolean exists or is read). The link
  // count is bound to the plan (EXPECTED_SEEDS − 1 = 120, the last being the forward commitment
  // published after the final rotation), and the chain is ANCHORED at epoch 0: the rotation record
  // that opens epoch 0 (seeds[0]) was taken no later than the first bet of that epoch settled, at
  // one-second resolution (created_at is whole seconds, so the check compares floor(seeds[0].at)).
  // A record taken in a later second than its epoch's first bet FAILs. Within the shared second the
  // order rests on the capture script awaiting the rotation response before dealing. This anchor is
  // NOT the profile's pre-capture link (BLACKJACK-02): seeds[0] was recorded inside the capture
  // (0.834 s after meta.createdAt), in the same whole second as epoch 0's first bet, and it compares
  // the capture's clock with the operator's created_at. The capture reference reads the active seed's
  // next hash before the first rotation, compares it in memory with the hash that rotation makes
  // active and then overwrites it (capture/capture.reference.js lines 426-444); the dataset holds no
  // link before epoch 0.
  {
    let linked = 0, broken = 0;
    for (let i = 0; i < ctx.seeds.length - 1; i++) {
      const curr = ctx.seeds[i].seed;
      const next = ctx.seeds[i + 1].seed;
      if (curr.nextServerSeedHash === next.serverSeedHashed) linked++;
      else broken++;
    }
    const s0 = ctx.seeds[0];
    const epoch0 = ctx.bets.filter(b => s0 && b.server_seed_hashed === s0.seed.serverSeedHashed);
    const firstSettle = epoch0.length ? Math.min(...epoch0.map(b => Date.parse(b.deal?.created_at) / 1000)) : NaN;
    const anchorAt = s0 ? Date.parse(s0.at) / 1000 : NaN;
    const anchored = epoch0.length > 0 && Number.isFinite(firstSettle) && Math.floor(anchorAt) <= firstSettle;
    const expectedLinks = EXPECTED_SEEDS - 1;
    results.push(step(2, 'Commitment Linkage',
      broken === 0 && linked === expectedLinks && anchored ? 'PASS' : 'FAIL',
      `${linked}/${expectedLinks} consecutive seed links verified from raw fields (seeds[i].nextServerSeedHash == seeds[i+1].serverSeedHashed; population from src/loader.ts), ${broken} broken. ` +
      `First-epoch anchor: seeds[0] (${s0?.seed.serverSeedHashed.substring(0, 16)}…) recorded ${s0?.at} by the capture's clock, no later than the first of its ${epoch0.length} bets settled (${epoch0.length ? new Date(firstSettle * 1000).toISOString() : 'none'} by the operator's created_at, whole seconds): ${anchored ? 'yes' : 'NO'}. ` +
      `seeds[0] was recorded inside the capture, so it is not a pre-capture link. The capture reference reads the active seed's next hash before the first rotation, compares it in memory with the hash that rotation makes active and then overwrites it (capture/capture.reference.js lines 426–444); the dataset holds no link before the first epoch (MANIFEST.md, Pre-bet commitment evidence).`
    ));
  }

  // ── Step 3: Hash Consistency Within Epoch ───────────────────────────────────
  // NOT A TAUTOLOGY ANY MORE. The old step grouped bets BY server_seed_hashed (loader groupByHash)
  // and then asserted every bet in a group carried that group's hash — true by construction, FAIL
  // unreachable. The epoch is now derived from something the hash field does not control: the
  // casino's transaction id order and the rotation TIMELINE. Bets are ordered by transaction id
  // and cut into consecutive windows of EXPECTED_EPOCH_SIZE; window k must be the epoch opened by
  // rotation record seeds[k] — every bet in it carries that record's serverSeedHashed, clientSeed
  // and phase, and its settlement time (deal.created_at, whole-second resolution in this capture)
  // lies in [floor(seeds[k].at), seeds[k+1].at]. The last record (post-capture rotation) must
  // carry no bets. A bet re-labelled into another epoch, or an epoch spliced out of order, FAILS.
  {
    const ordered = [...ctx.bets].sort((a, b) => a.id - b.id);
    const idsStrict = ordered.every((b, i) => i === 0 || b.id > ordered[i - 1].id);
    const windows = Math.floor(ordered.length / EXPECTED_EPOCH_SIZE);
    const problems: string[] = [];
    let windowsBound = 0, betsBound = 0, timelineOk = 0;
    const tsec = (iso: string): number => Date.parse(iso) / 1000;

    if (!idsStrict) problems.push('transaction ids are not unique');
    if (ordered.length % EXPECTED_EPOCH_SIZE !== 0) problems.push(`${ordered.length} bets is not a whole number of ${EXPECTED_EPOCH_SIZE}-bet epochs`);
    if (windows !== EXPECTED_EPOCHS) problems.push(`${windows} epoch windows != ${EXPECTED_EPOCHS}`);
    if (ctx.seeds.length !== windows + 1) problems.push(`${ctx.seeds.length} rotation records != ${windows} windows + 1 closing record`);

    for (let k = 0; k < windows && k < ctx.seeds.length; k++) {
      const rec = ctx.seeds[k];
      const lo = Math.floor(tsec(rec.at));
      const hi = k + 1 < ctx.seeds.length ? tsec(ctx.seeds[k + 1].at) : Infinity;
      let windowOk = true;
      for (let j = 0; j < EXPECTED_EPOCH_SIZE; j++) {
        const b = ordered[k * EXPECTED_EPOCH_SIZE + j];
        const bound = b.server_seed_hashed === rec.seed.serverSeedHashed
          && b.client_seed === rec.seed.clientSeed && b.phase === rec.phase;
        if (bound) betsBound++;
        else {
          windowOk = false;
          if (problems.length < 5) problems.push(`bet ${b.id} (window ${k}) carries ${b.server_seed_hashed.substring(0, 16)}/${b.client_seed}/${b.phase}, rotation record seeds[${k}] is ${rec.seed.serverSeedHashed.substring(0, 16)}/${rec.seed.clientSeed}/${rec.phase}`);
        }
        const t = tsec(b.deal?.created_at);
        if (Number.isFinite(t) && t >= lo && t <= hi) timelineOk++;
        else {
          windowOk = false;
          if (problems.length < 5) problems.push(`bet ${b.id} settled ${b.deal?.created_at}, outside seeds[${k}] window [${rec.at}, ${ctx.seeds[k + 1]?.at ?? '∞'}]`);
        }
      }
      if (windowOk) windowsBound++;
    }
    const closing = ctx.seeds[ctx.seeds.length - 1];
    const betsOnClosing = closing ? ctx.bets.filter(b => b.server_seed_hashed === closing.seed.serverSeedHashed).length : 0;
    if (betsOnClosing > 0) problems.push(`${betsOnClosing} bets carry the closing record's live commitment`);

    const expectedBets = EXPECTED_EPOCHS * EXPECTED_EPOCH_SIZE;
    const ok = problems.length === 0 && windowsBound === EXPECTED_EPOCHS
      && betsBound === expectedBets && timelineOk === expectedBets;
    results.push(step(3, 'Hash Consistency Within Epoch',
      ok ? 'PASS' : 'FAIL',
      `${windowsBound}/${EXPECTED_EPOCHS} epochs bound to their rotation record: bets ordered by casino transaction id and cut into ${EXPECTED_EPOCH_SIZE}-bet windows, ` +
      `window k carries seeds[k]'s serverSeedHashed + clientSeed + phase (${betsBound}/${expectedBets} bets) and settles inside seeds[k].at..seeds[k+1].at ` +
      `(${timelineOk}/${expectedBets}; created_at is whole-second, so the window opens at floor(seeds[k].at)). ` +
      `Closing record seeds[${ctx.seeds.length - 1}] carries ${betsOnClosing} bets.` +
      (problems.length ? ` Problems: ${problems.join('; ')}` : '')
    ));
  }

  // ── Step 4: Nonce Audit ─────────────────────────────────────────────────────
  // The old "retroactive verification" of a gap tested four conditions of which three held by
  // construction: getCard() always returns one of the 52 card strings, a missing nonce is by
  // definition absent from its epoch, and (hash, nonce) absent from the global index is the same
  // fact again because epochs were grouped by hash. So every gap was "verified" and the step had
  // no reachable failure. What IS decidable about a nonce the capture never saw is only that its
  // seed is revealed and committed (Step 1) — the game dealt there is not verified, and the detail
  // says so. The step now FAILS on what an operator could actually do wrong in the nonce stream:
  // an epoch that does not start at nonce 0, a nonce served twice, or nonces that do not increase
  // with the casino's transaction order.
  //
  // Capture-retry gaps follow the Duel video-poker / plinko standard (2026-09-23):
  //   - a gap whose epoch seed is unrevealed, or revealed but not hashing to the commitment, FAILs;
  //   - the number of gaps is bound to the capture plan (src/loader.ts EXPECTED_CAPTURE_RETRY_GAPS),
  //     so a gap more or a gap fewer is a different dataset and FAILs;
  //   - the planned gaps are a capture-origin FLAG, not a PASS: the seed is revealed and committed,
  //     but the hand dealt at the missed nonce was not captured. Disclosed on every run,
  //     verdict-neutral.
  // REGISTER, NOT A COUNT (profile BLACKJACK-04). Every gap must be a row of
  // DECLARED_CAPTURE_RETRY_GAPS (src/loader.ts) whose evidence — the settlement-clock gap across the
  // missing nonce — is re-measured here and must be >= GAP_CLOCK_EVIDENCE_S; a gap not in the register
  // is operator-side and FAILs; a register row with no gap behind it FAILs as stale. Each epoch's
  // window must start at the DECLARED base NONCE_BASE and close at base + EXPECTED_EPOCH_SIZE +
  // (its declared gaps) − 1 — the capture recorded no per-epoch nonceEnd, so the window is closed
  // against the plan.
  {
    const hardFailures: string[] = [];
    const gapDetails: string[] = [];
    let epochs = 0, gaps = 0, gapEpochs = 0, duplicates = 0, windowsClosed = 0;
    const found = new Set<string>();
    const reg = new Map(DECLARED_CAPTURE_RETRY_GAPS.map(r => [`${r.commitment}:${r.nonce}`, r]));

    for (const [hash, bets] of ctx.byHash) {
      epochs++;
      const tag = hash.substring(0, 16);
      const byId = [...bets].sort((a, b) => a.id - b.id);
      const nonces = byId.map(b => b.nonce);
      const sorted = [...nonces].sort((a, b) => a - b);
      if (sorted[0] !== NONCE_BASE) hardFailures.push(`${tag}: first nonce ${sorted[0]} (declared base ${NONCE_BASE})`);
      const uniq = new Set(nonces);
      if (uniq.size !== nonces.length) {
        duplicates += nonces.length - uniq.size;
        hardFailures.push(`${tag}: ${nonces.length - uniq.size} nonce(s) served more than once`);
      }
      for (let i = 1; i < nonces.length; i++) {
        if (nonces[i] <= nonces[i - 1]) { hardFailures.push(`${tag}: nonce ${nonces[i]} settled after nonce ${nonces[i - 1]} (transaction order)`); break; }
      }
      const seed = ctx.seedMap.get(hash);
      const seedChecked = seed !== undefined && hashServerSeed(seed) === hash;
      let epochGaps = 0;
      for (let i = 1; i < sorted.length; i++) {
        for (let n = sorted[i - 1] + 1; n < sorted[i]; n++) {
          gaps++; epochGaps++;
          const key = `${tag}:${n}`;
          found.add(key);
          const row = reg.get(key);
          const before = byId.find(b => b.nonce === sorted[i - 1])!, after = byId.find(b => b.nonce === sorted[i])!;
          const clock = (Date.parse(after.deal?.created_at) - Date.parse(before.deal?.created_at)) / 1000;
          if (!row) hardFailures.push(`${tag}: nonce ${n} missing and NOT in the capture-retry register — operator-side gap`);
          else if (!(clock >= GAP_CLOCK_EVIDENCE_S) || clock !== row.clockGapS) hardFailures.push(`${tag}: nonce ${n} register evidence does not hold (clock gap ${clock} s, register ${row.clockGapS} s, threshold ${GAP_CLOCK_EVIDENCE_S} s)`);
          if (!seedChecked) hardFailures.push(`${tag}: nonce gap at ${n} under a seed that is ${seed ? 'revealed but does not hash to the commitment' : 'UNREVEALED'}`);
          gapDetails.push(`${tag} nonce ${n} (phase ${bets[0].phase}, clock gap ${clock} s, ${row?.dl ?? 'unregistered'})`);
        }
      }
      if (epochGaps) gapEpochs++;
      const closeAt = NONCE_BASE + EXPECTED_EPOCH_SIZE + epochGaps - 1;
      if (sorted[sorted.length - 1] === closeAt && bets.length === EXPECTED_EPOCH_SIZE) windowsClosed++;
      else hardFailures.push(`${tag}: window ${sorted[0]}..${sorted[sorted.length - 1]} does not close at ${closeAt} (${bets.length} bets, ${epochGaps} declared gap(s))`);
    }
    for (const r of DECLARED_CAPTURE_RETRY_GAPS) {
      if (!found.has(`${r.commitment}:${r.nonce}`)) hardFailures.push(`register row ${r.commitment}:${r.nonce} is stale — no gap there`);
    }
    if (epochs !== EXPECTED_EPOCHS) hardFailures.push(`${epochs} epochs != ${EXPECTED_EPOCHS}`);
    if (gaps !== EXPECTED_CAPTURE_RETRY_GAPS || DECLARED_CAPTURE_RETRY_GAPS.length !== EXPECTED_CAPTURE_RETRY_GAPS) {
      hardFailures.push(`${gaps} nonce gap(s), ${DECLARED_CAPTURE_RETRY_GAPS.length} register rows, plan ${EXPECTED_CAPTURE_RETRY_GAPS}`);
    }

    const s4Data = { epochs, gaps, expectedGaps: EXPECTED_CAPTURE_RETRY_GAPS, registerRows: DECLARED_CAPTURE_RETRY_GAPS.length, gapEpochs, duplicates, windowsClosed };
    const head = `${epochs}/${EXPECTED_EPOCHS} epochs start at the declared base ${NONCE_BASE}, no nonce served twice (${duplicates} duplicates), nonces strictly increase with casino transaction id, ` +
      `${windowsClosed}/${EXPECTED_EPOCHS} windows close at base + ${EXPECTED_EPOCH_SIZE} + declared gaps − 1. `;
    results.push(hardFailures.length > 0
      ? step(4, 'Nonce Audit', 'FAIL',
          `${hardFailures.length} nonce violation(s): ${hardFailures.slice(0, 4).join('; ')}`, s4Data)
      : gaps === 0
        ? step(4, 'Nonce Audit', 'PASS', head + 'No nonce gaps.', s4Data)
        : step(4, 'Nonce Audit', 'FLAG',
            head +
            `${gaps} missing nonce(s) in ${gapEpochs} epoch(s), each a row of the capture-retry register (src/loader.ts, MANIFEST.md DL-1) whose evidence re-measured here holds: ` +
            `a settlement-clock gap >= ${GAP_CLOCK_EVIDENCE_S} s across it (gap-free pairs: median 3 s, 99th percentile 10 s) — the capture script's error path plays the in-flight hand out unrecorded and backs off 3 s. ` +
            `For each, the revealed server seed hashes to its epoch's commitment (hash equality, a consistency check; when the commitment was shown rests on the capture's rotation records, Steps 2–3), but the hand dealt at the missed nonce was not captured and is NOT verified. ` +
            `Capture-origin FLAG: disclosed, verdict-neutral. ${gapDetails.join('; ')}`,
            s4Data, 'capture'));
  }

  return results;
}
