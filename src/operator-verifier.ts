/**
 * THE OPERATOR'S OWN VERIFIER CODE (profile BLACKJACK-09; Step 38, third leg).
 *
 * Duel.com's Provably Fair → Verify page, with Blackjack selected, shows a JavaScript code panel
 * (evidence E04). That code is the operator's published algorithm for Blackjack: the only
 * operator-authored source for the draw this audit has. Until 2026-09-25 src/rng.ts was transcribed
 * from the page and cited nothing a check could hold it to (MANIFEST.md DL-6, premise P2).
 *
 * PROVENANCE. Copied by Paulo from duel.com → Provably Fair → Verify (Blackjack), the code panel, on
 * 2026-09-25, and saved verbatim as evidence/verify-tab/duel-verify-tab-blackjack-2026-09-25.js
 * (3,612 bytes, 112 lines, file mtime 2026-09-25T13:32:05-03:00). The file is never edited. What
 * this does NOT establish: that the Verify button on the live page runs exactly the code its panel
 * displays, or that Duel's server runs it — the panel is what the operator publishes as its
 * algorithm, and that is what is pinned and executed here.
 *
 * WHAT THIS FILE DOES.
 *   1. PINS the SHA-256 of that file and of the runner that executes it (OPERATOR_VERIFIER_PINS).
 *      A file that does not hash to its pin FAILs Step 38 before anything runs.
 *   2. EXECUTES the file — not a re-typing of it — in a child Node process
 *      (verifier-parity/operator/run-operator-verifier.cjs; its header lists the whole harness
 *      surface: a function wrapper that hands the file Node's WebCrypto, TextEncoder and a console
 *      recorder, and the calls to the file's own validateBlackjackResult and
 *      generateInfiniteDeckCard). Not one character of the file is rewritten, even in memory.
 *      The child process is used because the file awaits WebCrypto and the suite is synchronous.
 *   3. CHECKS THE CITATIONS: every line src/rng.ts cites (OPERATOR_SOURCE_CITES) must carry, at that
 *      line number of the pinned file, the text it quotes.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { OPERATOR_SOURCE_CITES } from './rng';

export const PACKAGE_ROOT = path.join(__dirname, '..');
export const OPERATOR_VERIFIER_FILE = 'evidence/verify-tab/duel-verify-tab-blackjack-2026-09-25.js';
export const OPERATOR_VERIFIER_RUNNER = 'verifier-parity/operator/run-operator-verifier.cjs';

/** Package-relative path → SHA-256 of the exact bytes. */
export const OPERATOR_VERIFIER_PINS: Readonly<Record<string, string>> = Object.freeze({
  'evidence/verify-tab/duel-verify-tab-blackjack-2026-09-25.js': '1dabca2a387ace93fadfdf4c94c8fad5e60b6a6cab26bb655d0f7622f0fe16b2',
  'verifier-parity/operator/run-operator-verifier.cjs':         '07c33181a87d440ed3c8061c3a163cff2dd05f9739d8cb6c4ebc4ea3ffa704f3',
});

export const OPERATOR_VERIFIER_PROVENANCE = Object.freeze({
  copiedBy: 'Paulo',
  copiedOn: '2026-09-25',
  from: 'duel.com → Provably Fair → Verify, game Blackjack, the code panel (evidence E04 shows the page)',
  savedAs: OPERATOR_VERIFIER_FILE,
  sha256: '1dabca2a387ace93fadfdf4c94c8fad5e60b6a6cab26bb655d0f7622f0fe16b2',
  bytes: 3612,
  lines: 112,
});

/** The only thing the file prints when it runs as shipped (its inputs are empty strings). */
export const OPERATOR_EXPECTED_LOGS: readonly string[] = Object.freeze([
  'Please provide valid serverSeed, clientSeed, and nonce (>=0) before running.',
]);

export interface OperatorRound { id: string | number; serverSeed: string; clientSeed: string; nonce: number }
export interface OperatorRun {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  /** id → the 50 cards (cursors 0 … 49) the operator's validateBlackjackResult returned, or null if it threw. */
  cards: Map<string, string[] | null> | null;
  /** The operator's generateInfiniteDeckCard on each fixed hash, in input order. */
  hashCards: Array<{ hash: string; card: string | null; error: string | null }>;
  /** The operator file's own CARDS table. */
  cardsTable: string[];
  logs: string[];
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');


/**
 * HOW THE PINNED RUNNER IS STARTED (since 2026-09-25). Its stdin and stdout are temp FILES, not pipes, and
 * the run has a hard timeout. On 2026-09-25 a pipe-based run inside the Duel Blackjack mutation battery sat
 * for ~1 h 54 min with the runner idle at 0 % CPU and its pipe descriptors open, until it was killed by hand.
 * A file cannot fill, so the child never blocks on output nobody is reading; and a runner that does not exit
 * within OPERATOR_RUNNER_TIMEOUT_MS is SIGKILLed and reported as a failed run — the calling step FAILs, it
 * never waits. The runner itself (pinned) is unchanged.
 */
export const OPERATOR_RUNNER_TIMEOUT_MS = 300_000;
function runPinnedRunner(root: string, input: string): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-operator-runner-'));
  const inPath = path.join(dir, 'jobs.json');
  const outPath = path.join(dir, 'out.json');
  fs.writeFileSync(inPath, input);
  const inFd = fs.openSync(inPath, 'r');
  const outFd = fs.openSync(outPath, 'w');
  try {
    const r = spawnSync(process.execPath, [path.join(root, OPERATOR_VERIFIER_RUNNER), path.join(root, OPERATOR_VERIFIER_FILE)], {
      stdio: [inFd, outFd, 'pipe'],
      encoding: 'utf8',
      timeout: OPERATOR_RUNNER_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 1 << 24,
    });
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL';
    return {
      status: timedOut ? null : r.status,
      stdout: fs.readFileSync(outPath, 'utf8'),
      stderr: timedOut ? `runner killed after ${OPERATOR_RUNNER_TIMEOUT_MS} ms (hard timeout)` : (r.stderr || ''),
      error: r.error,
    };
  } finally {
    fs.closeSync(inFd);
    fs.closeSync(outFd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Hash the pinned files and, only if every one matches, run the operator's code on `rounds` and
 * `hashes`. Never throws: a failure is returned as `error` so the calling step reports a FAIL.
 */
export function runOperatorVerifier(rounds: OperatorRound[], hashes: string[] = [], root = PACKAGE_ROOT): OperatorRun {
  const files = Object.entries(OPERATOR_VERIFIER_PINS).map(([file, pinned]) => {
    const p = path.join(root, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  const empty = { cards: null, hashCards: [], cardsTable: [], logs: [] };
  if (!hashesMatch) return { files, hashesMatch, ...empty, error: 'operator Verify-tab code or its runner does not match its pinned SHA-256' };
  const r = runPinnedRunner(root, JSON.stringify({ rounds, hashes }));
  if (r.status !== 0) {
    return { files, hashesMatch, ...empty,
      error: `operator verifier runner exited ${r.status}: ${(r.stderr || String(r.error || '')).trim().slice(0, 400)}` };
  }
  try {
    const out = JSON.parse(r.stdout) as { logs: string[]; cardsTable: string[];
      results: Array<{ id: string | number; cards: string[] | null }>; hashCards: OperatorRun['hashCards'] };
    const cards = new Map<string, string[] | null>();
    for (const x of out.results) cards.set(String(x.id), x.cards);
    return { files, hashesMatch, cards, hashCards: out.hashCards, cardsTable: out.cardsTable, logs: out.logs, error: null };
  } catch (e) {
    return { files, hashesMatch, ...empty, error: `operator verifier output unreadable: ${(e as Error).message}` };
  }
}

/** Every citation in src/rng.ts must quote, verbatim, the pinned operator file at the line it names. */
export function checkOperatorCites(root = PACKAGE_ROOT): { checked: number; bad: string[] } {
  const p = path.join(root, OPERATOR_VERIFIER_FILE);
  if (!fs.existsSync(p)) return { checked: 0, bad: [`${OPERATOR_VERIFIER_FILE} not found`] };
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const bad: string[] = [];
  for (const c of OPERATOR_SOURCE_CITES) {
    const at = lines[c.line - 1];
    if (at === undefined || !at.includes(c.text)) bad.push(`L${c.line} does not contain ${JSON.stringify(c.text)} (it reads ${JSON.stringify((at ?? '').trim())})`);
  }
  if (OPERATOR_SOURCE_CITES.length === 0) bad.push('src/rng.ts cites no operator line');
  return { checked: OPERATOR_SOURCE_CITES.length, bad };
}

/**
 * Fixed hash vectors for the draw's branches no captured round reaches (0 rejected chunks in 33,194
 * captured draws — Step 35). Each is a 32-byte hash, 8 big-endian uint32 chunks; MAX_FAIR = 4294967248
 * = 0xFFFFFFD0.
 *   V1  first chunk 0xFFFFFFD0 (= MAX_FAIR, the smallest rejected value), second 0x00000005 → index 5 = 3H
 *   V2  first chunk 0xFFFFFFCF (= MAX_FAIR − 1, the largest accepted) → 4294967247 mod 52 = 51 = AC
 *   V3  seven rejected chunks (0xFFFFFFFF), the eighth 0x00000033 → index 51 = AC
 *   V4  all eight chunks rejected → both implementations throw
 *   V5  first chunk 0x01020304 → 16909060 mod 52 = 12 = 5D; a little-endian read (0x04030201 = 67305985,
 *       mod 52 = 45 = KH) would give a different card
 */
export const OPERATOR_HASH_VECTORS: ReadonlyArray<{ id: string; hash: string; card: string | null }> = Object.freeze([
  { id: 'V1', hash: 'ffffffd0' + '00000005' + '00'.repeat(24), card: '3H' },
  { id: 'V2', hash: 'ffffffcf' + '00'.repeat(28), card: 'AC' },
  { id: 'V3', hash: 'ff'.repeat(28) + '00000033', card: 'AC' },
  { id: 'V4', hash: 'ff'.repeat(32), card: null },
  { id: 'V5', hash: '01020304' + '00'.repeat(28), card: '5D' },
]);
