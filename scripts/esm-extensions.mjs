#!/usr/bin/env node
// Add `.js` to relative imports in the ESM build.
//
// The sources are written for a bundler (`import {x} from './errors'`), which
// is what the rest of the repo uses and what keeps `src/contract` a verbatim
// copy of the server's contract package. Node's ESM loader, however, does no
// extension guessing: it resolves specifiers literally, so an extensionless
// relative import fails with ERR_MODULE_NOT_FOUND at runtime — after a build
// that reported success, which is the annoying part.
//
// Rewriting the emitted JS (and the .d.ts, so editors resolve types the same
// way) is the standard fix and keeps the transform out of the sources. `./x`
// becomes `./x.js`, and a directory import `./contract/index` is already
// explicit because the sources never rely on directory resolution.

import {readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'esm');

// `from './x'` / `import('./x')` / `export … from '../y'` — relative only, and
// only when there is no extension already.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]*?)(\2)/g;

function fix(code) {
  return code.replace(SPECIFIER, (match, lead, quote, spec, close) => {
    if (/\.(js|mjs|cjs|json|css)$/.test(spec)) return match;
    return `${lead}${quote}${spec}.js${close}`;
  });
}

let touched = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(js|d\.ts)$/.test(entry)) continue;
    const before = readFileSync(path, 'utf8');
    const after = fix(before);
    if (after !== before) {
      writeFileSync(path, after);
      touched++;
    }
  }
}

walk(root);
console.log(`esm-extensions: rewrote relative specifiers in ${touched} file(s)`);
