#!/usr/bin/env node
// TypeScript checks and emits ESM first. Preserve the same file layout for CommonJS consumers.
import {readdirSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const source = join(dist, 'esm');
const target = join(dist, 'cjs');
function convert(directory) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { convert(path); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const output = join(target, relative(source, path));
    const result = transformSync(readFileSync(path, 'utf8'), {
      format: 'cjs', target: 'es2022', sourcemap: 'external', sourcefile: relative(target, path),
    });
    mkdirSync(dirname(output), {recursive: true});
    writeFileSync(output, result.code + `\n//# sourceMappingURL=${entry.name}.map\n`);
    writeFileSync(output + '.map', result.map);
  }
}
convert(source);
console.log('built CommonJS from the checked ESM build');
