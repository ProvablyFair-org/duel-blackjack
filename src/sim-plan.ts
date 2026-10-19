/**
 * The simulation plan, stated once so that src/simulate.ts (which runs it) and verify Steps 17/18
 * (which score its artifact) cannot disagree about the population. A verifier that read the stream
 * count, round count or seed count back from the artifact it was scoring would accept a shrunken
 * run that described itself consistently.
 */
export const PASS1_STREAMS      = 10;
export const PASS1_ROUNDS_EACH  = 1_000_000;
export const PASS1_ROUNDS_TOTAL = PASS1_STREAMS * PASS1_ROUNDS_EACH;
export const PASS2_NONCES       = 10_000;
export const EARLY_WINDOW       = 50;
/** Family-wise α for the per-stream serial tests (Bonferroni over PASS1_STREAMS). */
export const SERIAL_ALPHA_FAMILY = 0.01;
/** Per-seed two-sided α for the Pass 2 early-vs-extended cherry-pick z-test. */
export const CHERRY_ALPHA = 0.05;
