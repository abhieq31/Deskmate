// Builds deskmate.html: the whole app in ONE self-contained file (inline CSS, JS and images),
// which is what abhieq31.com/deskmate serves. Run after build:js and build:css:
//
//   npm run build
//
// js/app.js is already a single esbuild bundle of src/*.ts, so it is inlined as-is.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const dataUri = (path) => `data:image/svg+xml;base64,${Buffer.from(read(path)).toString('base64')}`;

let css = read('css/style.css').replace(/url\(\.\.\/(assets\/[^)]+\.svg)\)/g, (_, p) => `url("${dataUri(p)}")`);
const js = read('js/app.js');

let html = read('index.html');
const icon = dataUri('assets/icon.svg');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html: expected ${from}`);
  html = html.split(from).join(to);
};
swap('<link rel="stylesheet" href="css/style.css" />', `<style>\n${css}\n</style>`);
swap('<script type="module" src="js/app.js"></script>', '');
html = html.replace('</body>', () => `<script type="module">\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>\n</body>`);
swap('<link rel="manifest" href="manifest.webmanifest" />\n', '');
swap('href="assets/icon.svg"', `href="${icon}"`);
swap('src="assets/icon.svg"', `src="${icon}"`);
// the brand link would point at a folder when opened from disk
swap('<a class="sb-brand" href="./"', '<a class="sb-brand" href="#"');
swap('<html lang="en">', '<html lang="en" data-single-file>');

// committed at the repo root so GitHub Pages (deploy from branch) serves it as-is
writeFileSync(join(root, 'deskmate.html'), html);
console.log(`deskmate.html  ${(html.length / 1024).toFixed(0)} KB`);
