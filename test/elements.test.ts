// @natzar/client/elements: types only. The assertions below are COMPILE-time
// (the package typecheck, `tsc -p tsconfig.json`, includes this file); the
// runtime part only proves the entry adds nothing to a bundle. The
// `@ts-expect-error` lines fail the typecheck if a type becomes too loose.
import {it} from 'node:test';
import assert from 'node:assert/strict';
import type {} from '../dist/esm/elements/index.js';
import type {NatzarIntrinsicElements, NatzarPatientEventMap, NatzarProviderEventMap} from '../dist/esm/elements/index.js';
import type {} from '../dist/esm/react/index.js';
import type {JSX as ReactJSX} from 'react';

// Never called: type assertions only.
export function typeAssertions(): void {
  const el = document.createElement('natzar-async');
  el.addEventListener('natzar:message', (e) => {
    const consultId: string = e.detail.consultId;
    const author: 'patient' | 'agent' | 'physician' | 'system' = e.detail.author;
    // @ts-expect-error — D2: no message text reaches the host page.
    void e.detail.text;
    void consultId;
    void author;
  });
  el.addEventListener('natzar:payment', (e) => {
    if (e.detail.phase === 'started') e.preventDefault();
  });
  // @ts-expect-error — T12: no physician name on the patient `assigned` event (RG0 F8).
  const name: NatzarPatientEventMap['natzar:assigned']['detail']['physicianName'] = 'x';
  void name;

  const provider = document.querySelector('natzar-provider')!;
  provider.addEventListener('natzar:provider:unread-change', (e) => {
    const n: number = e.detail.count;
    void n;
  });
  provider.addEventListener('natzar:provider:open', (e) => {
    const kind: 'async' | 'telehealth' = e.detail.kind;
    void kind;
  });
  const canLeave: Promise<{canLeave: boolean}> = provider.canLeave();
  void canLeave;
  const opened: NatzarProviderEventMap['natzar:provider:open']['detail'] = {kind: 'async', consultId: 'c'};
  void opened;

  const attrs: NatzarIntrinsicElements['natzar-provider'] = {view: 'inbox', navigation: 'host', 'guard-unload': true};
  // @ts-expect-error — only the four views exist (D13).
  const badView: NatzarIntrinsicElements['natzar-provider'] = {view: 'everything'};
  void attrs;
  void badView;

  // React 19 keeps JSX under React.JSX: the react entry types the raw tags there.
  const reactAttrs: ReactJSX.IntrinsicElements['natzar-async'] = {consult: 'thr_1', theme: 'dark', className: 'widget'};
  // @ts-expect-error — themes are light, dark, auto.
  const badTheme: ReactJSX.IntrinsicElements['natzar-async'] = {theme: 'purple'};
  void reactAttrs;
  void badTheme;

  window.natzarConfig = {auth: async () => 'id-token', endpoint: 'https://api.acme.test/natzar'};
}

it('the elements entry is types only: it exports nothing at runtime', async () => {
  const mod = await import('../dist/esm/elements/index.js');
  assert.deepEqual(Object.keys(mod), []);
});
