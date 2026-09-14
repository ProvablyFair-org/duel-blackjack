/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence.
 *
 * outputs/verification-results.json is deliberately NOT pinned — it is this verifier's own
 * output and is rewritten on every run by construction.
 *
 * Regenerating an artifact legitimately means re-pinning it here, in the same commit, with the
 * run that produced it.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'rtp-convergence.html':
    '99eb686ca10223aa12e43c908a96be073e469abae8de3c5608bd7e0b8032f528',
  'simulation-results.json':
    '3707ab5aeff7b9e6ee9e736f93805307b9aaa4af4e4c63fbb1a99f24d5dc4b61',
});
