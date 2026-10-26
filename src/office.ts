// The office table: who beats whom, worked out from the games saved on this laptop.

// placeholder names that say nothing about who played
const ANON = new Set(['', '?', 'white', 'black', 'opponent', 'player 1', 'player 2']);

/**
 * Standings from finished games, best first: { name, played, won, drawn, lost, score }.
 * A win is 1 point, a draw ½. Names match regardless of case and spacing.
 */
export function standings(games) {
  const rows = new Map();
  const row = (raw) => {
    const name = String(raw || '').trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (ANON.has(key)) return null;
    if (!rows.has(key)) rows.set(key, { name, played: 0, won: 0, drawn: 0, lost: 0, score: 0 });
    return rows.get(key);
  };
  for (const g of games) {
    if (!['1-0', '0-1', '1/2-1/2'].includes(g.result)) continue;
    const w = row(g.white), b = row(g.black);
    for (const [r, mine] of [[w, '1-0'], [b, '0-1']]) {
      if (!r) continue;
      r.played++;
      if (g.result === '1/2-1/2') { r.drawn++; r.score += 0.5; } else if (g.result === mine) { r.won++; r.score++; } else r.lost++;
    }
  }
  return [...rows.values()].sort((a, b) => b.score - a.score || b.score / b.played - a.score / a.played || a.name.localeCompare(b.name));
}
