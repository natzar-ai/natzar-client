// T1 / §4.7 rule 12: `@natzar/client/server` in a BROWSER bundle fails at
// BUILD time, through the package's `browser` export condition (a stub that
// exports nothing) — no `typeof window` sniffing. Server runtimes resolve the
// real module through their own conditions, listed before `browser`.
//
// Built with esbuild from the repo root's node_modules (not a dependency of
// this package). The package is resolved by self-reference (its own
// "exports"), exactly as a consumer's bundler resolves it.
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {build, type BuildOptions} from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

async function bundle(contents: string, opts: BuildOptions) {
  return build({
    stdin: {contents, resolveDir: here, sourcefile: 'entry.ts', loader: 'ts'},
    bundle: true,
    write: false,
    logLevel: 'silent',
    format: 'esm',
    ...opts,
  });
}

describe('browser guard (T1)', () => {
  it('a browser bundle importing natzar from @natzar/client/server FAILS AT BUILD, naming the missing export', async () => {
    await assert.rejects(
      () => bundle("import {natzar} from '@natzar/client/server';\nexport const nz = natzar({identify: () => null});", {platform: 'browser'}),
      (e: {errors?: Array<{text: string}>}) => {
        const text = (e.errors ?? []).map((x) => x.text).join('\n');
        assert.match(text, /No matching export in ".*server\/browser\.js" for import "natzar"/);
        return true;
      },
    );
  });

  it('even a namespace import that dodges the named-export check gets a module that refuses to load', async () => {
    const out = await bundle("import * as s from '@natzar/client/server';\nexport const keys = Object.keys(s);", {platform: 'browser'});
    const code = out.outputFiles![0].text;
    assert.match(code, /server-only: it holds your Natzar API key/);
    assert.equal(/natzar\(\)|identify|NATZAR_API_KEY/.test(code.replace(/Mount natzar\(\)/, '')), false, 'none of the middleware is in the bundle');
  });

  it('server builds resolve the real middleware: node, Cloudflare workerd (whose conditions include browser), Vercel edge-light, Deno, Bun', async () => {
    const entry = "import {natzar} from '@natzar/client/server';\nexport const nz = natzar;";
    const node = await bundle(entry, {platform: 'node'});
    assert.match(node.outputFiles![0].text, /function natzar\(/);
    for (const condition of ['workerd', 'edge-light', 'deno', 'bun']) {
      // Wrangler's own condition set is ['workerd', 'worker', 'browser']: workerd must win.
      const out = await bundle(entry, {platform: 'browser', conditions: [condition, 'worker', 'browser']});
      assert.match(out.outputFiles![0].text, /function natzar\(/, condition);
    }
  });

  it('the browser entries stay browser-safe: /patient, /react and /elements bundle for the browser without the middleware or zod', async () => {
    const out = await bundle(
      "export {connectPatient} from '@natzar/client/patient';\nexport {NatzarAsync} from '@natzar/client/react';\nexport type {} from '@natzar/client/elements';",
      {platform: 'browser', external: ['react'], minify: true},
    );
    const code = out.outputFiles![0].text;
    assert.equal(code.includes('NATZAR_API_KEY'), false);
    assert.equal(/ZodError|zod/.test(code), false, 'no zod in the browser entries');
  });
});
