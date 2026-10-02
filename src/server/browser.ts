// What `@natzar/client/server` resolves to under the `browser` export
// condition (package.json), i.e. in any browser bundle.
//
// It exports NOTHING, so `import {natzar} from '@natzar/client/server'` fails
// the BUILD, where the mistake is cheap: esbuild reports `No matching export
// in … for import "natzar"`, Rollup and Vite `"natzar" is not exported by …`.
// The middleware holds your API key; a browser must never run it (T1).
//
// Deliberately not `typeof window` sniffing at runtime: that misfires on
// Deno 1.x (which has `window`) and under jsdom. Server runtimes resolve the
// real module through their own conditions (`node`, `workerd`, `edge-light`,
// `deno`, `bun`), which the package lists before `browser`.
//
// A bundler lenient enough to only WARN about the missing export still gets a
// module that refuses to load.

export {};

throw new Error(
  '@natzar/client/server is server-only: it holds your Natzar API key. Mount natzar() on your server ' +
    "and load the widget with <script src=\"/natzar/embed.js\"> (or @natzar/client/react) in the browser.",
);
