# Contributing to Deskmate

Thanks for helping out! Deskmate is deliberately simple: plain HTML, CSS and
ES modules, with no framework and no build step. Please keep it that way
unless there's a strong reason not to.

## Getting started

```bash
git clone https://github.com/<you>/Deskmate.git
cd Deskmate
python3 -m http.server 8080   # then open http://localhost:8080
npm test                      # unit tests (Node 18+, no install needed)
```

## Guidelines

- **Keep it dependency-free at runtime.** If you need a library, vendor a
  pinned copy into `vendor/` with its license file next to it.
- **Game logic goes in `js/game.js`** and should have a test in `tests/`.
  DOM code goes in `js/board.js` (the board) or `js/app.js` (everything else).
- **Match the surrounding style:** 2-space indentation, single quotes,
  semicolons, small functions, and comments that explain *why*.
- **Test the UI by hand** on a narrow (phone) and a wide (desktop) window.
  Try both click-to-move and drag, and both board orientations.
- **Accessibility:** buttons need labels, keyboard shortcuts must not fire
  while typing, and animations must respect `prefers-reduced-motion`.
- If you add a file to the app, add it to the `ASSETS` list in `sw.js` and
  bump `CACHE` so returning visitors get the update. If it's a JS module,
  also add it to `MODULES` in `scripts/build-single.mjs` (in dependency order).
- Run `npm run build`, open `deskmate.html` by double-click to check that
  the single-file offline version still works, and **commit the rebuilt
  `deskmate.html`**. CI fails if it is stale, because GitHub Pages serves
  the committed file.
- **Live snapshots are a wire format** (`snapshot()` in `js/app.js`,
  `js/remote.js`, `js/live.js`). Two laptops may run different versions:
  only add fields, and bump `v` if a change can't be read by older versions.
- To try live play without the internet, run any Nostr relay locally and set
  `localStorage['deskmate:relays'] = '["ws://localhost:7447"]'` in two
  browser profiles.

## Pull requests

1. Fork, then create a branch: `git checkout -b feature/opening-names`.
2. Make your change and run `npm test`.
3. Open a PR describing **what** changed and **why**. Add a screenshot or GIF for UI changes.

CI runs the tests on every PR. Merges to `main` deploy to GitHub Pages automatically.

## Reporting bugs

Open an issue with your browser and OS, the steps to reproduce, and the PGN
or FEN if it's position-specific. You can copy both from the side panel.
