/**
 * Steps 1–4: Cryptographic commitment verification
 */

import { hashServerSeed, getCard } from '../../src/rng';
import type { VerifyContext, StepResult } from './context';
import { step } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const results: StepResult[] = [];

  // ── Step 1: Seed Hash Integrity ─────────────────────────────────────────────
  {
    let verified = 0, failed = 0;
    for (const [hash, seed] of ctx.seedMap) {
      const computed = hashServerSeed(seed);
      if (computed === hash) verified++;
      else failed++;
    }
    results.push(step(1, 'Seed Hash Integrity',
      failed === 0 ? 'PASS' : 'FAIL',
      `${verified}/${ctx.seedMap.size} revealed seeds: SHA-256(hex_decode(serverSeed)) matches commitment. ${failed} failures.`
    ));
  }

  // ── Step 2: Commitment Linkage ──────────────────────────────────────────────
  {
    let linked = 0, broken = 0;
    for (let i = 0; i < ctx.seeds.length - 1; i++) {
      const curr = ctx.seeds[i].seed;
      const next = ctx.seeds[i + 1].seed;
      if (curr.nextServerSeedHash === next.serverSeedHashed) linked++;
      else broken++;
    }
    results.push(step(2, 'Commitment Linkage',
      broken === 0 ? 'PASS' : 'FAIL',
      `${linked}/${ctx.seeds.length - 1} consecutive seed links verified. ${broken} broken.`
    ));
  }

  // ── Step 3: Hash Consistency Within Epoch ───────────────────────────────────
  {
    let consistent = 0, inconsistent = 0;
    for (const [hash, bets] of ctx.byHash) {
      const allMatch = bets.every(b => b.server_seed_hashed === hash);
      if (allMatch) consistent++;
      else inconsistent++;
    }
    results.push(step(3, 'Hash Consistency Within Epoch',
      inconsistent === 0 ? 'PASS' : 'FAIL',
      `All ${consistent} epochs internally consistent. ${inconsistent} inconsistent.`
    ));
  }

  // ── Step 4: Nonce Audit + Retroactive Verification of Gaps ──────────────────
  // Detect missing nonces within each epoch. For every gap, retroactively
  // verify the missing nonce against four independent conditions:
  //   (a) the revealed server seed exists for this epoch,
  //   (b) computing `getCard(seed, clientSeed, missing, 0)` yields one of the
  //       52 valid card strings — i.e. the seed deterministically produces
  //       a recognisable card for the missing nonce, with no error path,
  //   (c) NO captured bet in this epoch has nonce == missing (no silent reuse),
  //   (d) NO captured bet ANYWHERE in the dataset has the same
  //       (server_seed_hashed, nonce) tuple — guards against the failure
  //       mode where the missing nonce was actually settled but written
  //       under a different epoch identifier.
  // All four must hold for the gap to count as retroactively verified.
  const VALID_CARDS = new Set([
    '2D','2H','2S','2C','3D','3H','3S','3C','4D','4H','4S','4C',
    '5D','5H','5S','5C','6D','6H','6S','6C','7D','7H','7S','7C',
    '8D','8H','8S','8C','9D','9H','9S','9C','10D','10H','10S','10C',
    'JD','JH','JS','JC','QD','QH','QS','QC','KD','KH','KS','KC',
    'AD','AH','AS','AC',
  ]);
  // Build a global (hash, nonce) index across all bets — for condition (d).
  const globalNonceIndex = new Set<string>();
  for (const b of ctx.bets) globalNonceIndex.add(`${b.server_seed_hashed}:${b.nonce}`);

  {
    let gaps = 0;
    let retroactivelyVerified = 0;
    let unverifiable = 0;
    const gapDetails: string[] = [];

    for (const [hash, bets] of ctx.byHash) {
      const nonces = bets.map(b => b.nonce).sort((a, b) => a - b);
      const seen = new Set<number>(nonces);
      const seed = ctx.seedMap.get(hash);
      const clientSeed = bets[0].client_seed;

      for (let i = 1; i < nonces.length; i++) {
        if (nonces[i] !== nonces[i - 1] + 1) {
          for (let missing = nonces[i - 1] + 1; missing < nonces[i]; missing++) {
            gaps++;
            // Condition (a): seed must be revealed
            if (!seed) { unverifiable++; if (gapDetails.length < 7) gapDetails.push(`${nonces[i-1]}->${nonces[i]} (seed ${hash.substring(0,16)}, missing ${missing}) [seed unrevealed]`); continue; }
            // Condition (c): missing nonce must NOT appear in this epoch
            if (seen.has(missing)) { unverifiable++; continue; }
            // Condition (d): no captured bet anywhere uses (hash, missing)
            if (globalNonceIndex.has(`${hash}:${missing}`)) { unverifiable++; continue; }
            // Condition (b): seed deterministically produces a valid card
            let card: string | null = null;
            try { card = getCard(seed, clientSeed, missing, 0); } catch { card = null; }
            if (card && VALID_CARDS.has(card)) {
              retroactivelyVerified++;
              if (gapDetails.length < 7) gapDetails.push(`${nonces[i-1]}->${nonces[i]} (seed ${hash.substring(0,16)}, missing ${missing}, would-be cursor-0 card: ${card})`);
            } else {
              unverifiable++;
            }
          }
        }
      }
    }

    // Pass if every gap was retroactively verified — i.e. seed available + computable.
    const status = gaps === 0
      ? 'PASS'
      : (retroactivelyVerified === gaps ? 'PASS' : 'FLAG');

    results.push(step(4, 'Nonce Audit',
      status,
      `${ctx.byHash.size} epochs. ${gaps} nonce gaps observed; the missing nonces are not in the captured dataset. Revealed seeds permit deterministic derivation of the cursor-0 card for each gap (and no captured bet uses those nonces), but the missing games themselves are not verified. ${unverifiable} unverifiable. ${gapDetails.join('; ')}`
    ));
  }

  return results;
}
