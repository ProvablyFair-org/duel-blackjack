/**
 * The RTP convergence chart, as a SELF-CONTAINED page: inline SVG, no script, nothing fetched.
 *
 * The pinned chart used to load Chart.js from cdn.jsdelivr.net, so the published artifact rendered
 * only if a third party served the same library forever — and what it drew was not in the pinned
 * bytes at all (profile BLACKJACK-27: no CDN scripts in a pinned chart). Every figure drawn here is
 * read from the simulation artifact's own fields by src/simulate.ts; nothing is recomputed.
 */
export interface ChartInput {
  streams: number;
  roundsPerStream: number;
  totalRounds: number;
  convergence: Array<{ rounds: number; rtp: number }>;
  simulatedRTP: number;
  engineRTP: number;
  fisherP: number;
  fisherT: number;
  fisherDf: number;
  serialFails: number;
}

const label = (n: number): string => n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n);

export function renderConvergenceHtml(c: ChartInput): string {
  const W = 960, H = 420, L = 70, R = 20, T = 20, B = 50;
  const pts = c.convergence.map(d => d.rtp * 100);
  const eng = c.engineRTP * 100;
  const lo = Math.floor(Math.min(...pts, eng) * 2) / 2, hi = Math.ceil(Math.max(...pts, eng) * 2) / 2;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, pts.length - 1);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo || 1);
  const ticks: string[] = [];
  for (let v = lo; v <= hi + 1e-9; v += 0.5) {
    ticks.push(`<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e0e0e0"/>` +
      `<text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#666">${v.toFixed(1)}%</text>`);
  }
  const xl = c.convergence.map((d, i) => `<text x="${x(i).toFixed(1)}" y="${H - B + 20}" text-anchor="middle" font-size="12" fill="#666">${label(d.rounds)}</text>`).join('');
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dots = pts.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="#1565c0"><title>${label(c.convergence[i].rounds)} rounds per stream: ${v.toFixed(4)}%</title></circle>`).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DUEL BLACKJACK — ${(c.totalRounds / 1e6).toFixed(0)}M SIMULATED HANDS</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; color: #333; padding: 24px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  h1 { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
  svg { width: 100%; height: auto; display: block; }
  .box { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 16px auto; max-width: 900px; text-align: center; }
</style>
</head><body>
<div class="container">
<h1>DUEL BLACKJACK — RTP CONVERGENCE</h1>
<p style="text-align:center;font-size:12px;color:#999;margin-bottom:16px">${c.streams} streams x ${(c.roundsPerStream / 1e6).toFixed(0)}M = ${(c.totalRounds / 1e6).toFixed(0)}M hands | mean of streams at each checkpoint | Fisher's method | S17 + DAS basic strategy</p>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative simulated RTP against the optimal-play engine RTP">
${ticks.join('\n')}
<line x1="${L}" x2="${W - R}" y1="${y(eng).toFixed(1)}" y2="${y(eng).toFixed(1)}" stroke="#e57373" stroke-dasharray="6 6" stroke-width="2"/>
<path d="${line}" fill="none" stroke="#1565c0" stroke-width="2"/>
${dots}
${xl}
<text x="${W - R}" y="${(y(eng) - 8).toFixed(1)}" text-anchor="end" font-size="12" fill="#e57373">Optimal-play RTP (engine, ${eng.toFixed(2)}%)</text>
<text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#666">rounds per stream (cumulative simulated RTP, blue)</text>
</svg>
<div class="box">
  Simulated RTP: <strong>${(c.simulatedRTP * 100).toFixed(4)}%</strong> | Optimal-play RTP (engine): <strong>${eng.toFixed(4)}%</strong> | Fisher's p: <strong>${c.fisherP.toFixed(6)}</strong> (T=${c.fisherT.toFixed(2)}, df=${c.fisherDf}) | Serial fails: ${c.serialFails}
</div>
</div>
</body></html>`;
}
