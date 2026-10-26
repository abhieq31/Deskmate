<div align="center">

<img src="assets/icon.svg" width="72" alt="OBChess logo" />

# OBChess

**Over-the-board chess for two people and one screen.**
Open it in a browser, put the laptop between you and a colleague, and play.

[**▶ Play now**](https://abhieq31.github.io/OBChess/) · [Report a bug](https://github.com/abhieq31/OBChess/issues/new?template=bug_report.md) · [Suggest a feature](https://github.com/abhieq31/OBChess/issues/new?template=feature_request.md)

<img src="docs/screenshot.png" alt="OBChess game screen: board in the centre, players, clocks and move list on the right" width="860" />

</div>

## Why

Chess sites get blocked on work networks. OBChess is one static page with no
server, no account and no tracking. It runs from GitHub Pages, from a file
share or from `localhost`. Once it has loaded, it also works offline.

## Features

- **The board turns to face whoever is to move.** After every move it spins
  180° and the pieces stay upright. You can turn this off.
- **Move hints like lichess and chess.com.** Click or drag a piece: dots show
  its legal moves and rings show captures.
- **Last move and check highlights.** The from/to squares are tinted and a
  king in check glows red.
- **Full rules.** Castling, en passant and promotion (with a piece picker).
  The game ends on checkmate, stalemate, threefold repetition, the 50-move
  rule or insufficient material.
- **Chess clocks.** Choose from bullet to classical, with increment, pause
  and a low-time warning.
- **Games stay in your browser.** A game in progress survives a reload.
  Finished games go to **Saved games**, where you can review, resume or
  download them as PGN.
- **PGN import and export**, plus copying the FEN of any position.
- **Move list with replay.** Click any move, or use ← → ↑ ↓.
- **Takeback, agreed draw, resign and rematch** (rematch swaps colours).
- **Right-click arrows and circles** for explaining a line to your opponent.
- **Five board themes**, synthesized move sounds, and the screen stays on
  during a game.
- **Responsive.** Works on a desktop, a tablet or a phone. It can be
  installed as an app (PWA).

<img src="docs/flip.png" alt="The board halfway through its flip animation" width="560" />

## Run it locally

No build step and no dependencies. Serve the folder over HTTP:

```bash
git clone https://github.com/abhieq31/OBChess.git
cd OBChess
python3 -m http.server 8080      # or: npx serve .
# open http://localhost:8080
```

ES modules don't load from `file://`, so opening `index.html` by double-click won't work.

Run the tests with `npm test`. They need Node 18 or later and nothing else.

## Deploy your own copy

1. Fork this repo.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` runs the
   tests and publishes the site to `https://<you>.github.io/OBChess/`.

Any static host works too (Netlify, Cloudflare Pages, an internal web
server). Copy `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`,
`vendor/` and `assets/`.

## Project layout

```
index.html            page shell & dialogs
css/style.css         all styling (themes, board, animations, responsive layout)
js/app.js             controller: UI wiring, clocks, persistence, dialogs
js/board.js           interactive board: render, click/drag, hints, arrows, flip
js/game.js            game model on top of chess.js: plies, results, PGN (pure, tested)
js/storage.js         localStorage wrapper
js/sound.js           Web Audio synthesized sounds
js/confetti.js        celebration effect
sw.js                 offline cache (service worker)
vendor/chess.js       chess rules engine (chess.js 1.4.0, BSD-2-Clause)
tests/                node:test unit tests for js/game.js
```

## Contributing

Contributions are welcome, from typo fixes to new features. See
[CONTRIBUTING.md](CONTRIBUTING.md). Some ideas:

- Opening name display (ECO lookup)
- Post-game analysis with a WebAssembly Stockfish build
- More piece sets and board themes
- Play from a custom FEN position or Chess960
- Translations
- An optional peer-to-peer mode (WebRTC) so two laptops can play each other

## Credits & licenses

- OBChess source code: [MIT](LICENSE)
- Rules engine: [chess.js](https://github.com/jhlywa/chess.js) by Jeff Hlywa, BSD-2-Clause
- Pieces: *cburnett* set by Colin M.L. Burnett, GPLv2+, via [lichess](https://github.com/lichess-org/lila). See [assets/pieces/cburnett/LICENSE.md](assets/pieces/cburnett/LICENSE.md)
- Visual language inspired by [lichess.org](https://lichess.org). Please support them.

Please use OBChess where your employer's policies allow it.
