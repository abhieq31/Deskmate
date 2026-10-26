# Contributing to Deskmate

Thanks for helping out! Deskmate is deliberately simple: TypeScript and SCSS,
no framework, no server, and no runtime dependencies beyond the vendored
files. Please keep it that way unless there's a strong reason not to.

## Getting started

```bash
git clone https://github.com/<you>/Deskmate.git
cd Deskmate
npm install                   # TypeScript, esbuild, Sass (development only)
npm run build                 # js/app.js, css/style.css and deskmate.html
python3 -m http.server 8080   # then open http://localhost:8080
npm run typecheck && npm test # tsc, then node --test on the .ts sources (Node 22.18+)
```

## Guidelines

- **Keep it dependency-free at runtime.** If you need a library, vendor a
  pinned copy into `vendor/` with its license file next to it. Stockfish
  (`vendor/stockfish`) is loaded only when someone opens an analysis. Keep it
  that way so the page stays light.
- **Game logic goes in `src/game.ts`** and should have a test in `tests/`.
  DOM code goes in `src/board.ts` (the board) or `src/app.ts` (everything else).
  Styles go in the matching partial in `src/styles/`.
- **TypeScript stays erasable** (no enums, namespaces or parameter
  properties) so Node can run the tests straight from the sources.
- **Match the surrounding style:** 2-space indentation, single quotes,
  semicolons, small functions, and comments that explain *why*.
- **Test the UI by hand** on a narrow (phone) and a wide (desktop) window.
  Try both click-to-move and drag, and both board orientations.
- **Accessibility:** buttons need labels, keyboard shortcuts must not fire
  while typing, and animations must respect `prefers-reduced-motion`.
- If you add an asset file, add it to the `ASSETS` list in `sw.js` and bump
  `CACHE` so returning visitors get the update. New modules need nothing:
  esbuild follows the imports.
- Run `npm run build` and **commit the rebuilt `js/app.js`, `css/style.css`
  and `deskmate.html`**. CI fails if they are stale, because GitHub Pages and
  abhieq31.com serve the committed files.
- **Live snapshots are a wire format** (`snapshot()` in `src/app.ts`,
  `src/remote.ts`, `src/live.ts`). Two laptops may run different versions:
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
