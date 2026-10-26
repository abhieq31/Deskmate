// Builds deskmate.html: the whole app in ONE self-contained file that runs by
// double-click (file://) with no server and no network. Zero dependencies.
//
//   node scripts/build-single.mjs
//
// Each ES module is wrapped in a function scope; imports become lookups in a
// module table, so modules can't clash on top-level names.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// dependency order: a module must come after everything it imports
const MODULES = ['vendor/chess.js', 'js/game.js', 'js/remote.js', 'js/board.js', 'js/storage.js',
  'js/sound.js', 'js/confetti.js', 'js/app.js'];

function wrapModule(path) {
  let src = read(path);
  const exportsList = [];
  // import { a, b } from './x.js';
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm, (_, names, from) => {
    const target = normalize(join(dirname(path), from)).replace(/\\/g, '/');
    if (!MODULES.includes(target)) throw new Error(`${path}: unknown import ${from}`);
    const bindings = names.split(',').map((n) => n.trim()).filter(Boolean)
      .map((n) => n.replace(/\s+as\s+/, ': '));
    return `const { ${bindings.join(', ')} } = __mods[${JSON.stringify(target)}];`;
  });
  if (/^\s*import\s/m.test(src)) throw new Error(`${path}: unsupported import form`);
  // export { a, b as c };
  src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, names) => {
    for (const n of names.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [local, exported = local] = n.split(/\s+as\s+/);
      exportsList.push(`${exported}: ${local}`);
    }
    return '';
  });
  // export const|let|function|class name
  src = src.replace(/^export\s+(const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    exportsList.push(name);
    return `${kind} ${name}`;
  });
  if (/^export\s/m.test(src)) throw new Error(`${path}: unsupported export form`);
  return `__mods[${JSON.stringify(path)}] = (() => {\n${src}\nreturn { ${exportsList.join(', ')} };\n})();\n`;
}

const dataUri = (path) => `data:image/svg+xml;base64,${Buffer.from(read(path)).toString('base64')}`;

let css = read('css/style.css').replace(/url\(\.\.\/(assets\/[^)]+\.svg)\)/g, (_, p) => `url("${dataUri(p)}")`);
const js = 'const __mods = {};\n' + MODULES.map(wrapModule).join('\n');

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
swap('<a class="brand" href="./"', '<a class="brand" href="#"');

// committed at the repo root so GitHub Pages (deploy from branch) serves it as-is
writeFileSync(join(root, 'deskmate.html'), html);
console.log(`deskmate.html  ${(html.length / 1024).toFixed(0)} KB`);
