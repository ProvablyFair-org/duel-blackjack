/**
 * Blackjack audit verification suite — 38 scored steps + informational items.
 * Expected: 36/38 PASS + 2 capture-origin FLAGs (Step 4, the seven capture-retry nonce gaps; Step 37,
 * funded insurance below the framework floor — never funded by the capture), verdict
 * PROVABLY FAIR — Full Pass, exit 0. A capture-origin FLAG is disclosed, verdict-neutral.
 * Run: npm run verify
 */

import * as fs   from 'fs';
import * as path from 'path';

import { loadDataset, checkDatasetHash, buildSeedMap, groupByHash, AUDIT_ID } from '../src/loader';
import type { VerifyContext, InfoItem } from './steps/context';

import * as commitment   from './steps/commitment';
import * as determinism  from './steps/determinism';
import * as payouts      from './steps/payouts';
import * as dataset      from './steps/dataset';
import * as simulation   from './steps/simulation';
import * as gameSpecific from './steps/game-specific';
import * as rules        from './steps/rules';
import * as statistical  from './steps/statistical';
import * as artifacts    from './steps/artifacts';
import * as framework    from './steps/framework';
import * as parity       from './steps/parity';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from '../src/diff';
import { labelFor, profileCoverageBlock } from '../src/profile-map';
import { runRtpClaimGate, RTP_CLAIM_STEP } from '../src/rtp-settings';
import { rtpClaimVerdict, RTP_FIGURE_OVERSTATED, RTP_FIGURE_OVERSTATED_EXIT } from '../src/rtp-claim';

// ── Pre-flight: dataset hash ───────────────────────────────────────────────────

const hashCheck = checkDatasetHash();
console.log('\n  Dataset hash check:');
console.log(`    Expected: ${hashCheck.expected}`);
console.log(`    Actual:   ${hashCheck.actual}`);
console.log(`    Status:   ${hashCheck.match ? 'MATCH' : 'MISMATCH — abort'}\n`);
if (!hashCheck.match) { process.exit(1); }

// ── Setup ─────────────────────────────────────────────────────────────────────

const ds      = loadDataset();
const seedMap = buildSeedMap(ds.bets, ds.seeds);

const bets   = ds.bets;
const seeds  = ds.seeds;
const phaseA = bets.filter(b => b.phase === 'A');
const phaseB = bets.filter(b => b.phase === 'B');
const phaseC = bets.filter(b => b.phase === 'C');
const phaseD = bets.filter(b => b.phase === 'D');
const phaseE = bets.filter(b => b.phase === 'E');
const phaseF = bets.filter(b => b.phase === 'F');

const outputsDir = path.join(__dirname, '../outputs');

console.log('==============================================================');
console.log('  BLACKJACK AUDIT — VERIFICATION SUITE');
console.log('==============================================================');
console.log(`  Dataset: ${bets.length} hands  |  Seeds: ${seeds.length}  |  Revealed: ${seedMap.size}`);
console.log(`  Phase A: ${phaseA.length}  B: ${phaseB.length}  C: ${phaseC.length}  D: ${phaseD.length}  E: ${phaseE.length}  F: ${phaseF.length}\n`);

// ── Build context ─────────────────────────────────────────────────────────────

const byHash = groupByHash(bets);

const ctx: VerifyContext = {
  bets, seeds, seedMap, byHash,
  phaseA, phaseB, phaseC, phaseD, phaseE, phaseF,
  outputsDir,
  datasetConfig: ds.config,
  drawCensus: null,
};

// ── Run scored steps ─────────────────────────────────────────────────────────

const results = [
  ...commitment.run(ctx),    // Steps  1– 4
  ...determinism.run(ctx),   // Steps  5– 6
  ...payouts.run(ctx),       // Steps  7– 9
  ...dataset.run(ctx),       // Steps 10–15
  ...simulation.run(ctx),    // Steps 16–18
  ...gameSpecific.run(ctx),  // Steps 19–27
  ...rules.run(ctx),         // Steps 28–33  (game-rule coverage)
  ...artifacts.run(ctx),     // Step  34     (pinned artifacts of record)
  ...framework.run(ctx),     // Steps 35–37  (draw bias bound, round replay & grammar, rule & coverage register)
  ...parity.run(ctx),        // Step  38     (player-verifier parity: docs site + live site)
];

// ── RTP-CLAIM rule (1.2.0, Methodology v1.1; wired 2026-10-14, decision D4) ───────
// The exact optimal-play RTP table held to the published claim (src/rtp-settings.ts). The package
// switch RTP_CLAIM_RULE_ENFORCED is true (D3, 2026-10-14). Status OVERSTATED (a house-side miss) is
// scored on the step carrying BLACKJACK-19 as an operator-origin FLAG (the profile's policy) and the
// verdict becomes RTP FIGURE OVERSTATED, exit 5 (rtpClaimVerdict) — never NOT PROVABLY FAIR: the
// draws themselves pass. Status FAIL means the committed table no longer equals this run (or its
// pin): a reproduction failure, exit 1, whether or not the rule is enforced; no step moves for it.
const rtpClaim = runRtpClaimGate();
console.log('');
for (const line of rtpClaim.lines) console.log(`  ${line}`);
const rtpOverstated = rtpClaim.status === 'OVERSTATED';
if (rtpOverstated) {
  const s = (results as any[]).find(r => r.step === RTP_CLAIM_STEP);
  if (s && s.status !== 'FAIL') {
    s.status = 'FLAG'; delete s.origin;   // operator-origin: this package marks only capture flags
    s.detail += ` — ${RTP_FIGURE_OVERSTATED} (RTP-CLAIM enforced): ${rtpClaim.result.minimalFix}`;
    // The step printed its own line when it ran, before this rule was scored. Print it again at the
    // status it is now counted at, so the console agrees with the summary and the emitted record.
    console.log(`  [FLAG] Step ${s.step} — ${s.name} (re-scored: RTP-CLAIM enforced, ${RTP_FIGURE_OVERSTATED})`);
    console.log(`         ${s.detail}`);
  }
}

// ── Run informational items ──────────────────────────────────────────────────

const infoItems: InfoItem[] = statistical.run(ctx);

// ── Summary ───────────────────────────────────────────────────────────────────

const passed   = results.filter(r => r.status === 'PASS').length;
const flags    = results.filter(r => r.status === 'FLAG').length;
const hardFail = results.filter(r => r.status === 'FAIL').length;
// A capture-origin FLAG (an auditor-side capture retry that left a nonce gap) is disclosed but
// verdict-neutral; only an operator-origin FLAG downgrades to Conditional Pass. Same rule as Duel
// plinko (adopted 2026-09-22): not a PASS, but not against the verdict either.
// INFO (profile policy INFORMATIONAL — the live-sample fit, Mike 2026-09-29): reported, never counted
// as a flag, never enters the verdict or the exit code.
const informational = results.filter(r => r.status === 'INFO').length;
const captureFlags  = results.filter(r => r.status === 'FLAG' && r.origin === 'capture');
const operatorFlags = results.filter(r => r.status === 'FLAG' && r.origin !== 'capture');
// Ranked by the rule's rtpClaimVerdict: a failed draw check (NOT PROVABLY FAIR) > RTP FIGURE
// OVERSTATED > Conditional Pass > Full Pass. This suite has no INCOMPLETE state.
const ruled    = rtpClaimVerdict({ fails: hardFail, complete: true, overstated: rtpOverstated, opFlags: operatorFlags.length });
const verdict  = ruled.verdict;

if (infoItems.length > 0) {
  console.log('');
  console.log('  +-- Informational Context (not scored) --');
  for (const item of infoItems) console.log(`  | ${item.label}: ${item.detail}`);
  console.log('  +--');
}

console.log('\n==============================================================');
console.log('  RESULTS SUMMARY');
console.log('==============================================================');
console.log(`  Passed:     ${passed}/${results.length}`);
console.log(`  Hard fails: ${hardFail}`);
console.log(`  Flags:      ${flags} (${operatorFlags.length} verdict-affecting, ${captureFlags.length} capture-origin)`);
if (informational > 0) console.log(`  Informational deviations: ${informational} (reported, not counted, verdict unchanged)`);
if (captureFlags.length > 0) {
  console.log('\n  CAPTURE-ORIGIN LIMITATIONS (disclosed, verdict-neutral):');
  for (const r of captureFlags) console.log(`  ⚑ Step ${r.step}: ${r.name}`);
}
console.log(`\n  VERDICT: ${verdict}`);
console.log('==============================================================\n');

// ── Write output ──────────────────────────────────────────────────────────────

// NO RUN METADATA in the record (profile rules.reproduction): it carried `generatedAt` until
// 2026-09-24, so no two emissions were byte-identical. The runtime is recorded in outputs/run/diff.json.
const verificationOutput = {
  auditId:     AUDIT_ID,
  totalBets:   bets.length,
  totalSeeds:  seeds.length,
  revealedSeeds: seedMap.size,
  // Each scored step says which ProvablyFair.org Blackjack profile check it implements, so the
  // conformance matrix is DERIVED from this artifact (src/profile-map.ts labels; it cannot change
  // what any step asserts).
  steps:       results.map(r => ({ ...r, ...labelFor(r.step) })),
  profileCoverage: profileCoverageBlock(),
  info:        infoItems,
  summary:     { passed, flags, operatorFlags: operatorFlags.length, captureFlags: captureFlags.length, hardFail, verdict },
};

// A VERIFICATION RUN MUST NOT REWRITE THE ARTIFACT IT SCORES. A run that disagrees with the
// committed evidence would otherwise destroy the evidence of the disagreement, and the next run
// would compare the repo against what the failing run had just written. This run writes under
// outputs/run/ — gitignored, a run record rather than audit evidence. The committed copy in
// outputs/ is refreshed only by PF_EMIT=1.
const PF_EMIT = process.env.PF_EMIT === '1';
const RUN_DIR = path.join(outputsDir, 'run');
const RESULTS_DIR = PF_EMIT ? outputsDir : RUN_DIR;
fs.mkdirSync(outputsDir, { recursive: true });
fs.mkdirSync(RUN_DIR, { recursive: true });

fs.writeFileSync(path.join(RESULTS_DIR, 'verification-results.json'), JSON.stringify(verificationOutput, null, 2));

const WROTE_TO = PF_EMIT ? 'outputs' : 'outputs/run';
console.log(`  Outputs written to: ${WROTE_TO}/verification-results.json`);
if (!PF_EMIT) console.log('  Committed artifact NOT modified.');

// ── Reproduction gate ─────────────────────────────────────────────────────────
// THE GATE IS "BEYOND TOLERANCE", NOT "ANY FIELD". Byte identity is the right bar for exact
// content — the dataset, hash-guarded above. It is the wrong bar for a DERIVED statistic:
// recomputed on other hardware a floating-point figure can move by a unit in the last place.
// Scoring that as a disagreement trains a reader to ignore the diff, which is the one outcome
// that makes it useless. The bound is declared in src/diff.ts, far below the precision of any
// figure this audit publishes; outside it is a DIFFERENT result, and the run exits 1.
let reproductionFailures = 0;
if (!PF_EMIT) {
  const readJsonOrNull = (p: string): unknown => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  };
  const targets: { file: string; fresh: unknown }[] = [
    { file: 'verification-results.json', fresh: verificationOutput },
  ];
  // `npm run test:full` regenerates the simulation into outputs/run/ (via `npm run simulate:run`);
  // when that run product is present, field-diff it against the pinned committed artifact so a
  // regeneration that drifts beyond the reproduction tolerance is caught. Plain `npm test` does
  // not regenerate it, so there is nothing to diff and the pinned artifact is scored as-is by
  // Steps 17/18 and hashed by Step 34.
  const runSim = readJsonOrNull(path.join(RUN_DIR, 'simulation-results.json'));
  if (runSim !== null) targets.push({ file: 'simulation-results.json', fresh: runSim });
  const perFile = targets.map(t => {
    const committed = readJsonOrNull(path.join(outputsDir, t.file));
    // `generatedAt` is a property of the run, not of the evidence, and differs by construction.
    const diffs = fieldDiff(committed, t.fresh, ['generatedAt']);
    return { file: t.file, readable: committed !== null, diffs, real: beyondTolerance(diffs) };
  });
  const allDiffs  = perFile.flatMap(p => p.diffs);
  const realTotal = perFile.reduce((n, p) => n + p.real.length, 0);
  const gap       = maxima(allDiffs);

  fs.writeFileSync(path.join(RUN_DIR, 'diff.json'), JSON.stringify({
    runtime: process.versions.node,
    verdict,
    tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL, rule: '|a-b| <= atol + rtol*max(|a|,|b|); two distinct integers never agree' },
    reproduced: realTotal === 0,
    beyondToleranceCount: realTotal,
    withinToleranceCount: allDiffs.length - realTotal,
    largestGap: gap,
    note: 'Field-level diff between the COMMITTED artifact and THIS RUN. `generatedAt` is '
      + 'excluded because it differs by construction. Entries marked `withinTolerance` are the '
      + 'same result computed on different hardware and are recorded, not scored. Any entry NOT '
      + 'so marked means this run disagrees with the committed evidence — investigate it; do not '
      + 're-run until it goes away, and do not regenerate the committed artifact to make it go away.',
    files: perFile.map(p => ({ file: `outputs/${p.file}`, committedReadable: p.readable, differences: p.diffs })),
  }, null, 2));

  console.log(`  Reproduction vs the committed artifact on Node ${process.versions.node}: `
    + `${realTotal === 0 ? 'REPRODUCED' : `${realTotal} field(s) BEYOND TOLERANCE`}`
    + `${allDiffs.length - realTotal > 0 ? ` (${allDiffs.length - realTotal} within tolerance` + (gap ? `, largest ${gap.absDiff.toExponential(2)} at ${gap.path}` : '') + ')' : ''}`);
  console.log(`  Diff written to: outputs/run/diff.json`);
  if (realTotal > 0) {
    console.log('  ⚠ THIS RUN DISAGREES WITH THE COMMITTED EVIDENCE:');
    for (const p of perFile) {
      if (!p.readable) { console.log(`      outputs/${p.file}: committed copy absent or unreadable`); continue; }
      for (const d of p.real.slice(0, 4)) {
        console.log(`      ${p.file} ${d.path}: committed ${JSON.stringify(d.committed)} vs this run ${JSON.stringify(d.thisRun)}`);
      }
    }
  }
  reproductionFailures = realTotal;
} else {
  console.log('  REPORT GENERATION (PF_EMIT=1): the committed artifact in outputs/ was rewritten.');
}

// ── Exit contract ─────────────────────────────────────────────────────────────
// FAIL -> 1, RTP FIGURE OVERSTATED -> 5, operator-origin FLAG -> 2, otherwise 0, so an automated
// caller reads the verdict from the exit status. A reproduction beyond tolerance — the committed
// RTP-claim table included — is a FAIL, not a warning: a gate that only prints is not a gate.
if (hardFail > 0 || reproductionFailures > 0 || !rtpClaim.tableMatches) process.exit(1);
if (ruled.exit === RTP_FIGURE_OVERSTATED_EXIT) process.exit(RTP_FIGURE_OVERSTATED_EXIT);
if (operatorFlags.length > 0) process.exit(2);
// A capture-origin FLAG is disclosed but verdict-neutral: exit 0, so npm test stays green.
