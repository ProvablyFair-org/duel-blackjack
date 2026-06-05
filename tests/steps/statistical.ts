/**
 * Informational items — live-bet statistical context (not scored).
 * These are underpowered at live-bet sample sizes; authoritative tests are in simulation.
 */

import type { VerifyContext, InfoItem } from './context';

export function run(ctx: VerifyContext): InfoItem[] {
  const items: InfoItem[] = [];

  // Outcome distribution
  const outcomes: Record<string, number> = {};
  for (const b of ctx.bets) {
    const final = b.final?.blackjack || b.final?.blackjackNext?.blackjack;
    if (!final) continue;
    for (const h of final.player.hands) {
      const r = h.result || 'unknown';
      outcomes[r] = (outcomes[r] || 0) + 1;
    }
  }
  const total = Object.values(outcomes).reduce((a, b) => a + b, 0);
  const pcts = Object.entries(outcomes)
    .sort(([,a], [,b]) => b - a)
    .map(([k, v]) => `${k}: ${v} (${(v/total*100).toFixed(1)}%)`)
    .join(', ');
  items.push({ label: 'Outcome Distribution', detail: pcts });

  // Natural BJ frequency
  const bjCount = outcomes['blackjack'] || 0;
  const bjPct = (bjCount / ctx.bets.length * 100).toFixed(2);
  const bjExpected = (8/169 * 100).toFixed(2);
  items.push({ label: 'Natural BJ Frequency', detail: `${bjCount}/${ctx.bets.length} = ${bjPct}% (expected ${bjExpected}% = 8/169)` });

  // Side bet hit rates
  let ppHits = 0, ppActive = 0, t3Hits = 0, t3Active = 0;
  for (const b of ctx.bets) {
    const sb = b.deal?.blackjack?.side_bet_results;
    if (!sb) continue;
    const pp = sb.side_perfect_pairs;
    const t3 = sb.side_21_plus_3;
    if (pp && parseFloat(pp.amount_placed || '0') > 0) {
      ppActive++;
      if ((pp.multiplier || 0) > 0) ppHits++;
    }
    if (t3 && parseFloat(t3.amount_placed || '0') > 0) {
      t3Active++;
      if ((t3.multiplier || 0) > 0) t3Hits++;
    }
  }
  items.push({ label: 'PP Hit Rate', detail: `${ppHits}/${ppActive} = ${(ppHits/ppActive*100).toFixed(2)}% (expected ${(4/52*100).toFixed(2)}% = 4/52)` });
  items.push({ label: '21+3 Hit Rate', detail: `${t3Hits}/${t3Active} = ${(t3Hits/t3Active*100).toFixed(2)}% (expected ~9.88%)` });

  return items;
}
