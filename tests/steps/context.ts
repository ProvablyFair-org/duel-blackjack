import type { BJBet, BJSeed } from '../../src/loader';

export interface StepResult {
  step:   number;
  name:   string;
  status: 'PASS' | 'FLAG' | 'FAIL';
  detail: string;
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
  // Mutable accumulators
  step5Mismatches: number;
  step5Skipped:    number;
  chiResultsLog:   Record<string, unknown>[];
}

export function step(
  num:    number,
  name:   string,
  status: 'PASS' | 'FLAG' | 'FAIL',
  detail: string,
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'FLAG' ? '[FLAG]' : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  return { step: num, name, status, detail };
}
