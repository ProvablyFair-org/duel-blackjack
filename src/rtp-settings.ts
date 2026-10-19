/**
 * RTP-CLAIM wiring — Duel Blackjack: the per-setting exact RTP table and the claim it is held to.
 *
 * Added 14 October 2026 under Methodology v1.1, decision D4 (Mike: "D1, D4, D5, D6 (approve the cited
 * versions) and D9: go with your recommendations"; D4: an rtp-claim-table.json for Blackjack, RTP
 * under optimal play, "Blackjack (99.43%)" passes on its own maths, Zero Edge rakeback noted, not
 * tested).
 *
 * The rule is src/rtp-claim.ts, a byte-identical copy of the framework's core/rtp-claim.ts (its
 * SHA-256 is compared by conformance C-13), version 1.2.0 (Methodology v1.1, agreed 2026-10-14). The
 * enforcement switch RTP_CLAIM_RULE_ENFORCED is the package's own src/rtp-claim-switch.ts, set to
 * true (decision D3): the outcome is scored on the step carrying BLACKJACK-19, and a house-side miss
 * makes the verdict RTP FIGURE OVERSTATED (exit 5), never NOT PROVABLY FAIR.
 *
 * SETTINGS. One: the main bet under Duel's rules (src/config.ts RULES: infinite deck, dealer stands
 * on soft 17, double after split, no surrender, no re-split), played optimally, RTP per initial bet.
 * The side bets (Perfect Pairs, 21+3) are not in this table: their edges are exact at the captured
 * paytable (Step 16), and Duel states them as zero edge (E19 §1), a zero-edge line, noted, not tested.
 * EXACT RTP. The independent exact-rational oracle's figure for the declared rules, pinned in
 * src/config.ts ORACLE_RTP.stand (anchor/oracle.py, Python Fractions, printed 2026-09-24):
 * 7016161098045143337706614398 / 7056410014866816666030739693 = 99.4296119877 %. Step 16 requires the
 * package's own engine (src/optimal-play.ts) to equal it within 1e-12, so the row is the existing
 * optimal-play solve, held exactly.
 * CLAIM. Flat 99.43 % (house edge 0.57 %): the figure a Duel staff member stated for blackjack, in a
 * post relayed to ProvablyFair.org on 1 May 2026 (evidence/E19-duel-blackjack-edge-statements.md §2;
 * the post itself was not retrieved by this audit), as the package documents it
 * (MANIFEST.md#duels-stated-edge) and Methodology v1.1 D4 cites it ("Blackjack (99.43%)"). It is NOT
 * one of the rule's six places (game page, fairness page, help page, bet panel, rules, game
 * settings). The game settings (E18) state house_edge 0.001 on the main bet's first scaling-edge tier;
 * Duel describes that as the net edge after its blackjack rakeback (E19 §1: "It just gives a 0.44% (or
 * something like that) rakeback to make it 0.1% net edge"), so under D3 it is a rakeback line, noted,
 * not tested, and is not the claim here.
 *
 *   npm run rtp-claim:write    rewrite outputs/rtp-claim-table.json and print its SHA-256 to pin
 */
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { RtpClaim, RtpClaimAccumulator, RtpClaimResult, rtpClaimTable, rtpClaimGate, RtpClaimGate } from './rtp-claim';
import { ORACLE_RTP, RULES_IN_EFFECT } from './config';

export const RTP_CLAIM: RtpClaim = {
  kind: 'flat',
  rtp: '0.9943',
  source: 'Duel staff statement, not one of the six places: a Duel staff member gave blackjack\'s house edge as 0.57% in a post relayed to ProvablyFair.org on 1 May 2026 (evidence/E19-duel-blackjack-edge-statements.md §2; the post was not retrieved), as MANIFEST.md#duels-stated-edge documents it and Methodology v1.1 D4 cites it ("Blackjack (99.43%)"). The game settings (E18) state house_edge 0.001 on the main bet\'s first scaling-edge tier, which Duel describes as the net edge after its rakeback (E19 §1): a rakeback line, noted, not tested (D3)',
};

/** The scored step that carries the RTP half of BLACKJACK-19 (src/profile-map.ts): both RTP conventions. */
export const RTP_CLAIM_STEP = 16;

export const RTP_CLAIM_TABLE = path.join(__dirname, '..', 'outputs', 'rtp-claim-table.json');
/** SHA-256 of the committed table — re-pin with the run that rewrote it (npm run rtp-claim:write). */
export const RTP_CLAIM_TABLE_SHA256 = '18ac6e4eea89ec13311c71cdf7c5b71188afa7d537b287eacf58948f1f75996b';

export function computeRtpClaim(): RtpClaimResult {
  // The oracle fraction for the rule set in effect (src/config.ts RULES, single-sourced). Duel's rules
  // are S17 (ORACLE_RTP.stand); a RULES edit to H17 must not crash the run — Step 14 is what scores
  // that (mutation M14b) — so the table follows RULES and then no longer equals its committed copy.
  const soft17 = RULES_IN_EFFECT.soft17;
  const [n, d] = ORACLE_RTP[soft17];
  const acc = new RtpClaimAccumulator(RTP_CLAIM);
  acc.add(`main bet, optimal play (infinite deck, ${soft17 === 'stand' ? 'S17' : 'H17'}, DAS, no surrender, no re-split), per initial bet`, BigInt(n), BigInt(d));
  return acc.result();
}

export function rtpClaimTableText(r: RtpClaimResult): string {
  return rtpClaimTable(r, {
    package: 'duel/blackjack', game: 'blackjack',
    settingSpace: 'one setting: the main bet under Duel\'s declared rules (infinite deck, dealer stands on soft 17, double after split, no surrender, no re-split), optimal play; the side bets (Perfect Pairs, 21+3) are not in this table',
    rtpMethod: 'exact rational: the independent oracle anchor/oracle.py (Python Fractions) for the declared rules, pinned in src/config.ts ORACLE_RTP.stand; Step 16 requires the engine src/optimal-play.ts to equal it within 1e-12; RTP per initial bet',
  });
}

export function runRtpClaimGate(): RtpClaimGate {
  const r = computeRtpClaim();
  return rtpClaimGate(r, rtpClaimTableText(r), RTP_CLAIM_TABLE, RTP_CLAIM_TABLE_SHA256);
}

if (require.main === module) {
  const text = rtpClaimTableText(computeRtpClaim());
  fs.writeFileSync(RTP_CLAIM_TABLE, text);
  console.log(`wrote outputs/rtp-claim-table.json sha256 ${createHash('sha256').update(text).digest('hex')}`);
}
