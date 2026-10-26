// Opening names from lichess's chess-openings data set (CC0), built into vendor/openings/openings.json
// by scripts/build-openings.mjs. Fetched once, only when a game has moves to name.
import { vendorUrl } from './engine.js';

let table = null;

/** The table: position (FEN without move counters) → "ECO Name". */
export function loadOpenings() {
  table = table || fetch(vendorUrl('openings/openings.json')).then((r) => {
    if (!r.ok) throw new Error(`openings: ${r.status}`);
    return r.json();
  });
  table.catch(() => { table = null; });
  return table;
}

/** Name of the deepest known position in `fens` (oldest first), without the ECO code; or null. */
export function openingName(openings, fens) {
  for (let i = fens.length - 1; i >= 0; i--) {
    const hit = openings[fens[i].split(' ').slice(0, 4).join(' ')];
    if (hit) return hit.slice(4);
  }
  return null;
}
