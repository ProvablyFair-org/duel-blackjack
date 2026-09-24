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
