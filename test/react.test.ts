// @natzar/client/react: the tags as components. Rendered with react-dom/server
// (no DOM is installed: the effects are tested through the pure helpers they
// call — the loader injection, the attribute sync and the event binding —
// against minimal stand-ins).
import {describe, it, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
  NatzarAgent,
  NatzarAsync,
  NatzarProvider,
  NatzarTelehealth,
  PATIENT_EVENT_PROPS,
  PROVIDER_EVENT_PROPS,
  bindNatzarEvents,
  ensureNatzarLoader,
  natzarLoaderSrc,
  syncAttributes,
} from '../dist/esm/react/index.js';

const g = globalThis as {window?: unknown; customElements?: unknown};
afterEach(() => {
  delete g.window;
  delete g.customElements;
});

describe('React components — markup', () => {
  it('renders each tag with its attributes; presence-only booleans are present or absent, never "false"', () => {
    assert.equal(renderToStaticMarkup(createElement(NatzarAsync, {})), '<natzar-async></natzar-async>');
    assert.equal(renderToStaticMarkup(createElement(NatzarTelehealth, {consult: 'tele_1', theme: 'dark'})), '<natzar-telehealth consult="tele_1" theme="dark"></natzar-telehealth>');
    assert.equal(
      renderToStaticMarkup(createElement(NatzarAgent, {accentForeground: '#fff', fontFamily: 'Inter, sans-serif', radius: 12, manual: false})),
      '<natzar-agent radius="12" accent-foreground="#fff" font-family="Inter, sans-serif"></natzar-agent>',
    );
    assert.equal(
      renderToStaticMarkup(createElement(NatzarProvider, {view: 'inbox', navigation: 'host', guardUnload: true, patient: 'p-7'})),
      '<natzar-provider patient="p-7" view="inbox" navigation="host" guard-unload=""></natzar-provider>',
    );
    assert.equal(renderToStaticMarkup(createElement(NatzarProvider, {guardUnload: false})), '<natzar-provider></natzar-provider>');
  });

  it('never renders an event handler, a secret or a session into the markup', () => {
    const html = renderToStaticMarkup(createElement(NatzarAsync, {onMessage: () => {}, onPayment: () => {}, loader: '/pinned/natzar.1.2.3.js'}));
    assert.equal(html, '<natzar-async></natzar-async>');
  });
});

describe('React components — events', () => {
  it('maps every contract event name to its handler prop', () => {
    const patient = Object.fromEntries(PATIENT_EVENT_PROPS);
    assert.equal(patient['natzar:message'], 'onMessage');
    assert.equal(patient['natzar:payment'], 'onPayment');
    assert.equal(PATIENT_EVENT_PROPS.length, 12);
    const provider = Object.fromEntries(PROVIDER_EVENT_PROPS);
    assert.equal(provider['natzar:provider:unread-change'], 'onUnreadChange');
    assert.equal(provider['natzar:provider:switch-request'], 'onSwitchRequest');
    assert.equal(provider['natzar:provider:consultation-completed'], 'onConsultationCompleted');
    assert.equal(provider['natzar:provider:open'], 'onOpen');
    assert.equal(PROVIDER_EVENT_PROPS.length, 11);
  });

  it('calls the LATEST handler with (detail, event); unbinding removes every listener', () => {
    const el = new EventTarget();
    const seen: string[] = [];
    let handlers: Record<string, unknown> = {onMessage: (d: {messageId: string}) => seen.push(`a:${d.messageId}`)};
    const unbind = bindNatzarEvents(el, PATIENT_EVENT_PROPS, () => handlers);
    el.dispatchEvent(new CustomEvent('natzar:message', {detail: {consultId: 'c', messageId: 'm1', author: 'physician', sentAt: 'x'}}));
    handlers = {onMessage: (d: {messageId: string}) => seen.push(`b:${d.messageId}`)};
    el.dispatchEvent(new CustomEvent('natzar:message', {detail: {consultId: 'c', messageId: 'm2', author: 'physician', sentAt: 'x'}}));
    // The cancelable payment event reaches the handler as the event itself.
    handlers = {onPayment: (_d: unknown, e: Event) => e.preventDefault()};
    const payment = new CustomEvent('natzar:payment', {detail: {consultId: 'c', phase: 'started'}, cancelable: true});
    el.dispatchEvent(payment);
    assert.equal(payment.defaultPrevented, true);
    unbind();
    handlers = {onMessage: () => seen.push('after unbind')};
    el.dispatchEvent(new CustomEvent('natzar:message', {detail: {}}));
    assert.deepEqual(seen, ['a:m1', 'b:m2']);
  });
});

describe('React components — attributes and the loader', () => {
  function fakeElement() {
    const attrs = new Map<string, string>();
    return {
      attrs,
      hasAttribute: (n: string) => attrs.has(n),
      getAttribute: (n: string) => attrs.get(n) ?? null,
      setAttribute: (n: string, v: string) => void attrs.set(n, v),
      removeAttribute: (n: string) => void attrs.delete(n),
    };
  }

  it('keeps attributes as attributes: set, change, remove; booleans presence-only', () => {
    const el = fakeElement();
    syncAttributes(el as never, {theme: 'dark', consult: 'thr_1', 'guard-unload': true, manual: false, radius: 8});
    assert.deepEqual([...el.attrs], [['theme', 'dark'], ['consult', 'thr_1'], ['guard-unload', ''], ['radius', '8']]);
    syncAttributes(el as never, {theme: 'light', consult: undefined, 'guard-unload': false, manual: false, radius: 8});
    assert.deepEqual([...el.attrs], [['theme', 'light'], ['radius', '8']]);
  });

  function fakeDocument(existing: string[] = []) {
    const appended: Array<{src: string; async: boolean; attrs: Record<string, string>}> = [];
    const scripts = existing.map((src) => ({getAttribute: () => src}));
    const doc = {
      getElementsByTagName: () => scripts,
      createElement: () => {
        const s = {src: '', async: false, attrs: {} as Record<string, string>, setAttribute(n: string, v: string) {
          this.attrs[n] = v;
        }};
        return s;
      },
      head: {appendChild: (s: {src: string; async: boolean; attrs: Record<string, string>}) => void appended.push(s)},
    };
    return {doc, appended};
  }

  it('injects the loader script once per URL, async, and not when it is already on the page or defined', () => {
    const {doc, appended} = fakeDocument();
    ensureNatzarLoader('/natzar/embed.js', 'natzar-async', doc as never);
    ensureNatzarLoader('/natzar/embed.js', 'natzar-async', doc as never);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].src, '/natzar/embed.js');
    assert.equal(appended[0].async, true);
    assert.equal(appended[0].attrs['data-natzar-loader'], '');

    const manual = fakeDocument(['/natzar-ca/embed.js']);
    ensureNatzarLoader('/natzar-ca/embed.js', 'natzar-async', manual.doc as never);
    assert.equal(manual.appended.length, 0, 'a script tag the customer placed is reused');

    g.customElements = {get: (tag: string) => (tag === 'natzar-provider' ? class {} : undefined)};
    const defined = fakeDocument();
    ensureNatzarLoader('/natzar-us/embed.js', 'natzar-provider', defined.doc as never);
    assert.equal(defined.appended.length, 0, 'a pinned loader already defined the tag');
    ensureNatzarLoader('/natzar-us/embed.js', undefined, undefined);
  });

  it('derives the loader URL: a valid endpoint prop, else a PLAIN natzarConfig.endpoint, else /natzar', () => {
    assert.equal(natzarLoaderSrc(), '/natzar/embed.js');
    assert.equal(natzarLoaderSrc('/natzar-ca'), '/natzar-ca/embed.js');
    assert.equal(natzarLoaderSrc('https://evil.test/natzar'), '/natzar/embed.js', 'the prop is same-origin only (T5)');
    g.window = {natzarConfig: {endpoint: 'https://api.acme.test/natzar'}};
    assert.equal(natzarLoaderSrc(), 'https://api.acme.test/natzar/embed.js');
    g.window = {natzarConfig: {endpoint: 'http://evil.test/natzar'}};
    assert.equal(natzarLoaderSrc(), '/natzar/embed.js', 'not https');
    // A DOM-clobbered natzarConfig (an <a id="natzarConfig">) is not a plain object: ignored.
    g.window = {natzarConfig: Object.assign(Object.create({tagName: 'A'}), {endpoint: 'https://evil.test/natzar'})};
    assert.equal(natzarLoaderSrc(), '/natzar/embed.js');
  });
});
