/**
 * PLAYER-VERIFIER PARITY (profile BLACKJACK-24).
 *
 * The ProvablyFair.org site ships a player-facing verifier for Duel Blackjack: the VerifyBets component
 * of the docs site, whose Blackjack derivation is `src/components/VerifyBets/games/blackjack/derive.js`
 * and whose only import is `src/components/VerifyBets/lib/hmac-sha256.js`. A player who pastes a
 * round into that page is trusting THAT code, not this package's src/rng.ts. Until 2026-09-24 the
 * two were related by nothing but a comment in derive.js ("Source of truth (audit repo): …
 * src/rng.ts") — a hand sync that no check could see break.
 *
 * WHAT THIS FILE DOES.
 *   1. PINS the SHA-256 of both site files as constants (SITE_VERIFIER_PINS).
 *   2. Holds a VENDORED copy of those exact bytes under verifier-parity/, laid out as on the site so
 *      derive.js's relative import names the same file. The vendored bytes must hash to the pins or
 *      Step 38 FAILs.
 *   3. EXECUTES the vendored derive.js — not a re-typing of it — on every captured round (its
 *      deriveBlackjackSync replays the recorded actions itself), and Step 38 requires its cards,
 *      per-hand outcomes and gross returns, dealer hand and side-bet multipliers to equal this
 *      package's recomputation (src/round.ts) on every round. Any disagreement is a FAIL.
 *   scripts/check-site-verifier.mjs compares a live checkout of the site with the pins (exit 1 on
 *   any difference), so a site edit that was never re-vendored is caught at release time.
 *
 * HOW THE VENDORED ES MODULE IS RUN. The suite is synchronous CommonJS and must run with zero
 * install (verify.js), and derive.js is an ES module with an extensionless relative import that
 * Node's ESM resolver would refuse. So the bytes are evaluated with node:vm, each file wrapped in
 * its own function scope, after exactly two
 * textual rewrites, applied to the in-memory copy only and never to the hashed file: the ONE import
 * line (which must match IMPORT_LINE byte for byte — any other import set FAILs, because it would
 * be code this check does not vendor) is replaced by bindings to the vendored library, and the
 * `export ` keyword is dropped from each top-level declaration. No other character is touched, so
 * every line of logic that runs is a line whose bytes are pinned.
 *
 * RE-VENDORED 2026-09-25 from the site's origin/main @ bd4d59cd9a3e75146f2575c5218a3fb9a8b2692d (2026-09-19),
 * read with `git cat-file -p origin/main:<path>` (the local checkout was not switched or modified). The
 * bytes pinned before this date came from the local checkout's branch repotree-sync @ 2ad89bc, which is
 * NOT an ancestor of main; between the two, the vendored files of this game differ only in the source-URL
 * comment (github.com/ProvablyFair/… → github.com/ProvablyFair-org/…) — no line of logic changed.
 *
 * PROVENANCE OF THE PINNED BYTES (read 2026-09-24, read-only):
 *   repository  qa-workspace/duel/docusaurus (mikepforg/pf-audit-duel), HEAD
 *               2ad89bc774c4817abfe8ed0422af7b3e03e7c477; `git status` shows no change to either file
 *               (working tree == HEAD for both); derive.js last changed in f91b48e (2026-05-14,
 *               "Add files via upload"). hmac-sha256.js is byte-identical to the copy Duel Mines pins.
 *   The LIVE page (www.provablyfair.org/verify-bets) is a separate Next.js build; its deployed bundle is
 *   pinned and executed by src/live-site-verifier.ts (Step 38, second leg).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

export const SITE_VERIFIER_DIR = path.join(__dirname, '../verifier-parity');

/** Site-relative path → SHA-256 of the exact bytes. The vendored copies live at the same relative paths. */
export const SITE_VERIFIER_PINS: Readonly<Record<string, string>> = Object.freeze({
  'games/blackjack/derive.js': '1c20b41cfe7f15b85e4cc8d2db0ebbc8c267321e65e60a54c5063febad1b7201',
  'lib/hmac-sha256.js':    'bc30bfe9ef202905ece93de33440d41851abf16e910f90c2a567774a2b79d889',
});

export const SITE_VERIFIER_PROVENANCE = Object.freeze({
  siteRoot: 'qa-workspace/duel/docusaurus/src/components/VerifyBets',
  repository: 'mikepforg/pf-audit-duel',
  ref: 'origin/main',
  head: 'bd4d59cd9a3e75146f2575c5218a3fb9a8b2692d',
  headDate: '2026-09-19',
  readVia: 'git cat-file -p origin/main:<path>',
  readOn: '2026-09-25',
  previouslyPinnedFrom: 'repotree-sync @ 2ad89bc774c4817abfe8ed0422af7b3e03e7c477 (read 2026-09-24)',
});

/** The only import derive.js may carry. Anything else is code this check does not vendor. */
export const IMPORT_LINE = "import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';";

export interface SiteDerived {
  hands: Array<{ cards: string[]; outcome: string; doubled: boolean; payout: number }>;
  dealer: { cards: string[] };
  sideBets: { perfectPairs: { placed: boolean; multiplier: number }; twentyOnePlus3: { placed: boolean; multiplier: number } };
  multiplier: number;
  cursorsUsed: number;
}
export type SiteDerive = (p: { serverSeed: string; clientSeed: string; nonce: number; actions: string[];
  sideBets: { perfectPairs: boolean; twentyOnePlus3: boolean } }) => SiteDerived;

export interface SiteVerifierLoad {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  /** Present only when every hash matches and the module evaluated. */
  deriveBlackjack: SiteDerive | null;
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/** Drop `export ` from top-level declarations; nothing else. */
const stripExports = (src: string): string =>
  src.replace(/^export (function|const|let|class) /gm, '$1 ');

/**
 * Hash the vendored files against the pins and, only if every one matches, evaluate them.
 * Never throws: a failure is returned as `error` so Step 38 reports it as a FAIL.
 */
export function loadSiteVerifier(dir = SITE_VERIFIER_DIR): SiteVerifierLoad {
  const files = Object.entries(SITE_VERIFIER_PINS).map(([file, pinned]) => {
    const p = path.join(dir, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  if (!hashesMatch) {
    return { files, hashesMatch, deriveBlackjack: null, error: 'vendored site verifier does not match its pinned SHA-256' };
  }
  try {
    // Each file is wrapped in a function so its top-level names stay private to it. runInThisContext,
    // not runInNewContext: the pure-JS SHA-256 runs ~30x slower in a fresh context (133 µs vs 4 µs
    // per HMAC, measured 2026-09-24), which would have forced a sample instead of every round (measured on Duel Mines).
    const libSrc = fs.readFileSync(path.join(dir, 'lib/hmac-sha256.js'), 'utf8');
    const lib = (vm.runInThisContext(
      `(function () {\n${stripExports(libSrc)}\n;return { hmacSha256Hex, hexToBytes };\n})`,
      { filename: 'verifier-parity/lib/hmac-sha256.js' },
    ) as () => { hmacSha256Hex: unknown; hexToBytes: unknown })();

    const deriveSrc = fs.readFileSync(path.join(dir, 'games/blackjack/derive.js'), 'utf8');
    const importLines = deriveSrc.split('\n').filter(l => /^\s*import\b/.test(l));
    if (importLines.length !== 1 || importLines[0] !== IMPORT_LINE) {
      return { files, hashesMatch, deriveBlackjack: null,
        error: `derive.js imports ${JSON.stringify(importLines)}; the only vendored import is ${JSON.stringify(IMPORT_LINE)}` };
    }
    const body = `(function (hmacSha256Hex, hexToBytes) {\n${stripExports(deriveSrc.replace(IMPORT_LINE, ''))}\n;return { deriveBlackjackSync };\n})`;
    const mod = (vm.runInThisContext(body, { filename: 'verifier-parity/games/blackjack/derive.js' }) as
      (h: unknown, x: unknown) => { deriveBlackjackSync: SiteDerive })(lib.hmacSha256Hex, lib.hexToBytes);
    if (typeof mod.deriveBlackjackSync !== 'function') {
      return { files, hashesMatch, deriveBlackjack: null, error: 'derive.js does not define deriveBlackjackSync' };
    }
    return { files, hashesMatch, deriveBlackjack: mod.deriveBlackjackSync, error: null };
  } catch (e) {
    return { files, hashesMatch, deriveBlackjack: null, error: `vendored site verifier failed to evaluate: ${(e as Error).message}` };
  }
}
