/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence.
 *
 * outputs/verification-results.json is deliberately NOT pinned — it is this verifier's own
 * output. Its identity is guarded the other way round: a plain `npm run verify` writes to
 * outputs/run/ and field-diffs itself against the committed copy (the reproduction gate in
 * tests/verify.ts), so a run that disagrees with the record is caught without the record being
 * rewritten.
 *
 * The pin is the identity of the COMMITTED bytes and is never rewritten to make a regeneration
 * agree with it. Regenerating an artifact legitimately (`npm run simulate`, which is PF_EMIT=1)
 * means re-pinning it here, in the same commit, with the run that produced it. Whether a
 * regeneration is the SAME RESULT is a different question, answered at tolerance in
 * outputs/run/diff.json by `npm run test:full`.
 *
 * NO RUN METADATA (since 2026-09-24): the simulation artifact no longer carries `generatedAt`, and
 * the chart is self-contained inline SVG (it loaded Chart.js from a CDN). A regeneration on the
 * pinned SIM_SEEDS therefore reproduces both files BYTE FOR BYTE: measured 2026-09-24 on Node
 * 22.23.1, `npm run simulate:run` (outputs/run/) and `npm run simulate` (outputs/) wrote identical
 * bytes, and every one of the 647 values the previous committed artifact carried was unchanged —
 * the regeneration only removed `generatedAt` and added the per-stream first-card census and
 * wagered total and the per-seed extended variance and z (read by Steps 17 and 18). The field-diff
 * is still the reproduction test across machines; the pin is the integrity test.
 *
 * RE-PINNED 2026-09-24 (second round) for Pass 2 Test C (profile BLACKJACK-21): the regeneration ADDED
 * pass2.testC and, per seed, windowReturnHalf / testC_rank / testC_flag / firstCardRanks; all 1,027
 * values of the previous artifact (97f3e2d0…) were compared field by field and none changed, and the
 * chart's bytes did not change. `npm run simulate:run` and `npm run simulate` wrote identical bytes.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'rtp-convergence.html':
    'ae2618ec3e77e55f82ad49979672df9ebcf810a2287e3bed84a5aa0dc0842d23',
  'simulation-results.json':
    'd1e4e4cf8836f3369fef73bc61530f0539b8cf2e061b102600f636c4d414301c',
});
