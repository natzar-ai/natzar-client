#!/usr/bin/env node
// Copy the typed contract (shared/partner-api) into the published package.
//
// WHY A COPY. `shared/partner-api` is the single source of truth: the API
// server validates requests against its zod schemas and the public reference
// is generated from its doc comments. An npm package cannot reach up out of
// its own directory, so the contract has to physically live inside it — but it
// must never be EDITED there, or the client and the server would start
// documenting different APIs while both looked authoritative.
//
// So: this script copies, `--check` verifies the copy is current, and the
// package's `prepublishOnly` runs the check. A drifted contract fails the
// publish instead of shipping.

import {readdirSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, '..', '..', '..', 'shared', 'partner-api');
const TARGET = join(here, '..', 'src', 'contract');

const BANNER = `// GENERATED FILE — do not edit.
//
// Copied verbatim from provider-portal's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
`;

const check = process.argv.includes('--check');
const files = readdirSync(SOURCE).filter((f) => f.endsWith('.ts'));

mkdirSync(TARGET, {recursive: true});

let drifted = [];
for (const file of files) {
  const wanted = BANNER + readFileSync(join(SOURCE, file), 'utf8');
  const dest = join(TARGET, file);
  let current = null;
  try {
    current = readFileSync(dest, 'utf8');
  } catch {
    /* not copied yet */
  }
  if (current === wanted) continue;
  if (check) {
    drifted.push(file);
    continue;
  }
  writeFileSync(dest, wanted);
  console.log(`synced contract/${file}`);
}

if (check && drifted.length > 0) {
  console.error(
    `natzar-client: the bundled contract is out of date (${drifted.join(', ')}).\n` +
      `Run \`npm run sync-contract\` in packages/natzar-client and commit the result.`,
  );
  process.exit(1);
}
if (check) console.log('natzar-client: bundled contract is up to date.');
