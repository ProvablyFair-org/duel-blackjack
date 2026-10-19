/**
 * Step 34 — Artifact Integrity.
 *
 * Recompute the SHA-256 of every artifact of record and compare it with the pin in
 * src/artifact-pins.ts. A missing or altered artifact is a HARD FAIL, not a flag: the figures in
 * these files are published, and a flag exits 0.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { VerifyContext, StepResult } from './context';
import { step } from './context';
import { ARTIFACT_PINS } from '../../src/artifact-pins';
import { validateDomains, DOMAIN_RULES } from '../../src/domains';

export function run(ctx: VerifyContext): StepResult[] {
  const outputsDir = ctx.outputsDir ?? path.join(__dirname, '..', '..', 'outputs');

  const notes: string[] = [];
  let bad = 0;

  for (const [file, expected] of Object.entries(ARTIFACT_PINS)) {
    const fp = path.join(outputsDir, file);
    if (!fs.existsSync(fp)) {
      bad++;
      notes.push(`${file} ABSENT — a pinned artifact of record is missing`);
      continue;
    }
    const actual = createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    if (actual !== expected) {
      bad++;
      notes.push(`${file} sha256 ${actual.slice(0, 16)}… != pin ${expected.slice(0, 16)}… — the scored artifact is not the committed one`);
    } else {
      notes.push(`${file} matches its pin`);
    }
  }

  // VALUE DOMAINS (src/domains.ts). A pin proves the bytes did not change since pinning; it cannot
  // prove a value was ever possible — re-pinning a forgery satisfies it. Every numeric leaf of every
  // JSON artifact of record is held to the domain it physically admits (bounds from code), and an
  // UNDECLARED numeric leaf fails exactly like an impossible one.
  let leaves = 0;
  const domainProblems: string[] = [];
  const jsonArtifacts = Object.keys(ARTIFACT_PINS).filter(f => f.endsWith('.json'));
  for (const file of jsonArtifacts) {
    const fp = path.join(outputsDir, file);
    if (!fs.existsSync(fp)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { domainProblems.push(`${file} is not valid JSON`); continue; }
    const r = validateDomains(file, parsed);
    leaves += r.checked;
    domainProblems.push(...r.violations, ...r.uncovered.map(u => `${file} ${u}: numeric leaf with NO declared domain`));
  }
  for (const f of jsonArtifacts.filter(f => !(f in DOMAIN_RULES))) domainProblems.push(`${f}: no domain table in src/domains.ts`);
  // SELF-CONTAINED: a pinned HTML artifact may load nothing from elsewhere.
  for (const f of Object.keys(ARTIFACT_PINS).filter(f => f.endsWith('.html'))) {
    const fp = path.join(outputsDir, f);
    if (fs.existsSync(fp) && /<script\b[^>]*\bsrc=|<link\b[^>]*\bhref=\s*["']https?:|@import|https?:\/\//i.test(fs.readFileSync(fp, 'utf8')))
      domainProblems.push(`${f} references an external resource`);
  }

  return [step(34, 'Artifact Integrity (pinned artifacts of record)',
    bad === 0 && domainProblems.length === 0 ? 'PASS' : 'FAIL',
    `${Object.keys(ARTIFACT_PINS).length} artifact(s) checked against src/artifact-pins.ts; ` +
    notes.join('; ') +
    `. Value domains: ${leaves} numeric leaves of ${jsonArtifacts.length} JSON artifact(s) checked against src/domains.ts (bounds from code), ${domainProblems.length} problem(s)` +
    (domainProblems.length ? `: ${domainProblems.slice(0, 4).join('; ')}` : '; no pinned HTML artifact references an external resource.'),
    { artifactsPinned: Object.keys(ARTIFACT_PINS).length, mismatches: bad, domainLeavesChecked: leaves, domainProblems: domainProblems.length })];
}
