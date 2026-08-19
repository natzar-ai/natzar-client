#!/usr/bin/env node
// The package is `"type": "module"`, so Node reads every .js under it as ESM —
// including the CommonJS build. Dropping a `{"type":"commonjs"}` marker into
// dist/cjs is the standard way to say "this subtree is different", and it is
// what makes `require('@natzar/client')` work from a CJS consumer.
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cjs');
mkdirSync(dist, {recursive: true});
writeFileSync(join(dist, 'package.json'), JSON.stringify({type: 'commonjs'}, null, 2) + '\n');
console.log('wrote dist/cjs/package.json (type: commonjs)');
