import type { BJBet, BJSeed } from '../../src/loader';

export interface StepResult {
  step:   number;
  name:   string;
  /** INFO: an informational step's deviation (profile policy INFORMATIONAL — the live-sample fit, Mike
   *  2026-09-29): reported, never counted as a flag, never affects the verdict. */
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO';
  detail: string;
  /** The step's measurements, as numbers (never embedded as floats in `detail`). */
  data?:  Record<string, unknown>;
  /**
   * 'capture' marks a FLAG raised by the AUDITOR'S capture (a retried request that left a nonce
   * gap), not by anything the operator served. It is disclosed on every run but is
   * verdict-neutral: the verdict stays Full Pass and the exit status 0. Only an operator-origin
   * FLAG downgrades to Conditional Pass. Same rule as Duel plinko (adopted 2026-09-22).
   */
  origin?: 'capture';
}

export interface InfoItem {
  label:  string;
  detail: string;
}

export interface VerifyContext {
  bets:       BJBet[];
  seeds:      BJSeed[];
  seedMap:    Map<string, string>;   // serverSeedHashed → plaintext serverSeed
  byHash:     Map<string, BJBet[]>;  // grouped by epoch
  phaseA:     BJBet[];
  phaseB:     BJBet[];
  phaseC:     BJBet[];
  phaseD:     BJBet[];
  phaseE:     BJBet[];
  phaseF:     BJBet[];
  outputsDir: string;
  /** The dataset's own `config` block (the paytable the casino served at capture), scored by Step 14. */
  datasetConfig: any;
  // Mutable accumulator: Step 5's rejection census over every captured draw, read by Step 35.
  drawCensus: { draws: number; rejectedChunks: number; exhausted: number } | null;
}

export function step(
  num:    number,
  name:   string,
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO',
  detail: string,
  data?:  Record<string, unknown>,
  origin?: 'capture',
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'INFO' ? '[INFO]' : status === 'FLAG' ? (origin === 'capture' ? '[FLAG:capture]' : '[FLAG]') : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  const r: StepResult = data === undefined
    ? { step: num, name, status, detail }
    : { step: num, name, status, detail, data };
  if (status === 'FLAG' && origin === 'capture') r.origin = 'capture';
  return r;
}
