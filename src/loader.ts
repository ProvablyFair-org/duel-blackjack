/**
 * Dataset loader for Duel Blackjack audit.
 * Loads and validates the captured dataset.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATASET_FILE = 'blackjack-dataset-6000hands.json';
const DATASET_PATH = path.join(DATA_DIR, DATASET_FILE);

// Pinned SHA-256 of data/blackjack-dataset-6000hands.json
export const EXPECTED_HASH = '55d4b4b1850856c8a3ecf6e59021f1f80bb3d8053376c42929e58b6733b8cae4';

// ── POPULATION OF RECORD ─────────────────────────────────────────────────────────
// The capture plan, stated as CODE so a shrunken dataset cannot pass by agreeing with itself.
// Step 13 checked only the SET of phase labels — {A,B,C,D,E,F} present, none extra — so a dataset
// with a third of its hands deleted still satisfied it, and no count of hands or seeds lived in
// src/ at all. A row count is not an identity: re-pinning EXPECTED_HASH is exactly what a forger
// does, so the counts must come from somewhere the dataset does not control, and a mismatch must
// HARD FAIL. EXPECTED_EPOCH_SIZE moves here from tests/steps/dataset.ts for the same reason: the
// audited shape belongs in the source, where a reviewer looks for it.
export const EXPECTED_HANDS      = 6000;
export const EXPECTED_SEEDS      = 121;
export const EXPECTED_EPOCH_SIZE = 50;
export const EXPECTED_PHASE_HANDS: Readonly<Record<string, number>> =
  Object.freeze({ A: 3300, B: 1000, C: 500, D: 500, E: 200, F: 500 });
// Derived, not declared: 6000 hands / 50 per epoch = 120 bet-bearing epochs, one per rotation
// record except the last (seeds[120], the post-capture rotation, which carries no bets; its seed is
// not in the dataset, and E05 shows its next hash as the active commitment, so a later rotation
// replaced it). Phase D is one auditor client seed per epoch: 500 / 50 = 10.
export const EXPECTED_EPOCHS = EXPECTED_HANDS / EXPECTED_EPOCH_SIZE;
export const EXPECTED_PHASE_D_CLIENT_SEEDS = EXPECTED_PHASE_HANDS.D / EXPECTED_EPOCH_SIZE;

// Nonce gaps left by the capture: seven epochs each missing one nonce inside their run (the
// capture retried a request and the platform had already consumed the nonce). A property of the
// capture plan, disclosed as a capture-origin FLAG by step 4 — and a different number of gaps
// means a different dataset, which FAILs. Same rule as Duel video-poker and plinko.
export const EXPECTED_CAPTURE_RETRY_GAPS = 7;

/** The declared nonce base of every epoch (never the minimum observed). */
export const NONCE_BASE = 0;

/**
 * THE CAPTURE-RETRY REGISTER — each missing nonce named, with its evidence (profile BLACKJACK-04).
 * A count alone could not tell a retry from an operator-side gap: the step now requires the SET of
 * gaps to equal this register, row for row. A gap not listed is operator-side and FAILs; a row with
 * no gap behind it is stale and FAILs.
 *
 * Why these are the auditor's own retries and not games the operator withheld: the capture script's
 * error path (capture/capture.reference.js — `hand error` → clearStuckHand() → wait(3000) → retry)
 * plays an in-flight hand out by standing and does NOT record it, so the nonce that hand consumed
 * never reaches the dataset. Each row's EVIDENCE is the settlement-clock gap across the missing
 * nonce (deal.created_at, whole seconds): every one is >= GAP_CLOCK_EVIDENCE_S, above the 99th
 * percentile (10 s) of the 5,873 gap-free consecutive pairs (median 3 s), measured 2026-09-24 —
 * the time an error, a clear and a 3 s back-off take. Step 4 re-measures each row's clock gap and
 * FAILs a row whose evidence does not hold. Disclosed as MANIFEST.md DL-1.
 */
export const GAP_CLOCK_EVIDENCE_S = 14;
export const DECLARED_CAPTURE_RETRY_GAPS: ReadonlyArray<{ commitment: string; nonce: number; phase: string; clockGapS: number; dl: string }> = Object.freeze([
  { commitment: 'd1ec528647780f2f', nonce: 2,  phase: 'A', clockGapS: 16, dl: 'DL-1' },
  { commitment: '34cdf0e1b927a697', nonce: 35, phase: 'A', clockGapS: 31, dl: 'DL-1' },
  { commitment: 'c83531db458a4e74', nonce: 11, phase: 'A', clockGapS: 40, dl: 'DL-1' },
  { commitment: '45ee24c75397834b', nonce: 15, phase: 'A', clockGapS: 15, dl: 'DL-1' },
  { commitment: '981d7c37fccbba89', nonce: 37, phase: 'A', clockGapS: 14, dl: 'DL-1' },
  { commitment: '86525716901d3472', nonce: 7,  phase: 'B', clockGapS: 15, dl: 'DL-1' },
  { commitment: '004ea5229361e9bc', nonce: 24, phase: 'B', clockGapS: 16, dl: 'DL-1' },
]);

/** The capture script's fixed Phase D client seeds are this prefix + 00 … 09 (predictable by construction). */
export const PHASE_D_SEED_PREFIX = 'pfaudit_bj_seed';

/** The audit identifier assigned to this package, emitted into outputs/verification-results.json. */
export const AUDIT_ID = 'PF-2026-DL09';

export interface BJBet {
  id: number;
  nonce: number;
  phase: string;
  amount_currency: string;
  amount_won: string;
  effective_edge: number;
  server_seed_hashed: string;
  server_seed: string;
  client_seed: string;
  deal: any;
  final: any;
  actions: string[];
  actionResponses?: any[];
}

export interface BJSeed {
  at: string;
  context: string;
  phase: string;
  seed: {
    clientSeed: string;
    serverSeedHashed: string;
    nextServerSeedHash: string;
    serverSeed: string | null;
  };
  nonce: number;
}

export interface BJDataset {
  bets: BJBet[];
  seeds: BJSeed[];
  config: any;
  capturedAt: string;
  account: string;
}

export function computeDatasetHash(): string {
  const content = fs.readFileSync(DATASET_PATH);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function checkDatasetHash(): { expected: string; actual: string; match: boolean } {
  const actual = computeDatasetHash();
  return { expected: EXPECTED_HASH, actual, match: actual === EXPECTED_HASH };
}

export function loadDataset(): BJDataset {
  const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Build a Map<serverSeedHashed, serverSeed> from the seed entries + bet records.
 * Uses bet records as primary source since they have the revealed seeds.
 */
export function buildSeedMap(bets: BJBet[], seeds: BJSeed[]): Map<string, string> {
  const map = new Map<string, string>();

  // From bets (most reliable — every bet has server_seed from transaction API)
  for (const b of bets) {
    if (b.server_seed && b.server_seed_hashed) {
      map.set(b.server_seed_hashed, b.server_seed);
    }
  }

  // From seed entries (fills in any gaps)
  for (const s of seeds) {
    const sd = s.seed;
    if (sd.serverSeed && sd.serverSeedHashed && !map.has(sd.serverSeedHashed)) {
      map.set(sd.serverSeedHashed, sd.serverSeed);
    }
  }

  return map;
}

/**
 * Group bets by server_seed_hashed (epoch grouping).
 */
export function groupByHash(bets: BJBet[]): Map<string, BJBet[]> {
  const map = new Map<string, BJBet[]>();
  for (const b of bets) {
    const h = b.server_seed_hashed;
    if (!map.has(h)) map.set(h, []);
    map.get(h)!.push(b);
  }
  return map;
}
