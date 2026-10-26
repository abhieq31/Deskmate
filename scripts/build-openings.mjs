// Builds vendor/openings/openings.json from lichess's chess-openings data set (CC0):
//   git clone https://github.com/lichess-org/chess-openings && node scripts/build-openings.mjs chess-openings
// The result maps a position (FEN without the move counters) to "ECO Name", so a game is named
// by the deepest known position it passed through, transpositions included.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from '../vendor/chess.js';

const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/build-openings.mjs <path to chess-openings>');
const out = {};
for (const f of 'abcde') {
  const [, ...rows] = readFileSync(join(src, `${f}.tsv`), 'utf8').trim().split('\n');
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const c = new Chess();
    for (const san of pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/)) c.move(san);
    out[c.fen().split(' ').slice(0, 4).join(' ')] = `${eco} ${name}`;
  }
}
const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'openings', 'openings.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`${Object.keys(out).length} openings → ${dest}`);
