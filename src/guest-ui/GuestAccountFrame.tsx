// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useEffect, useRef, useState} from 'react';
import type {GuestClient} from '../guest/index';
import {loginCopy} from './login-copy';
import {createPatientFrameShell} from './payment-dialog';

/** The existing patient surface stays isolated in its own document. Only RPC crosses the frame. */
export function GuestAccountFrame({client, frameUrl, locale, onExpired, draft = '', onDraftChange}: {client: GuestClient; frameUrl: string; locale: string; onExpired(): void; draft?: string; onDraftChange?(value: string): void}) {
  const iframe = useRef<HTMLIFrameElement>(null), host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const bridge = useRef<MessagePort | null>(null);
  const initialDraft = useRef(draft).current;
  const [attempt, setAttempt] = useState(0), [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const copy = loginCopy(locale);
  const [nonce] = useState(() => crypto.randomUUID());
  const url = new URL(frameUrl); url.searchParams.set('parent', location.origin); url.searchParams.set('nonce', nonce); url.searchParams.set('locale', locale);
  useEffect(() => {
    let active = true, port: MessagePort | null = null;
    const shell = createPatientFrameShell(document, {overlay: overlay.current!, panel: panel.current!});
    setStatus('loading');
    const timer = setTimeout(() => setStatus('error'), 20_000);
    const ready = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== new URL(frameUrl).origin || event.data?.type !== 'natzar:account-ready' || event.data?.nonce !== nonce || port) return;
      const channel = new MessageChannel(); port = channel.port1; bridge.current = port;
      port.onmessage = async message => {
        const request = message.data as {id?: string; operation?: string; input?: Record<string, unknown>; type?: string; name?: string; detail?: {phase?: string}; draft?: string};
        if (request.type === 'draft' && typeof request.draft === 'string') {onDraftChange?.(request.draft.slice(0, 2000)); return;}
        if (request.type === 'event' && request.name === 'payment') {
          if (request.detail?.phase === 'started' && iframe.current) shell.present(iframe.current, locale); else shell.dismiss();
          return;
        }
        if (request.type === 'mounted') {clearTimeout(timer); if (active) setStatus('ready'); return;}
        if (typeof request.id !== 'string' || typeof request.operation !== 'string' || !client.accountOperation) return;
        const result = await client.accountOperation(request.operation, request.input ?? {});
        if (!active) return;
        port?.postMessage({id: request.id, result});
        if (result.error === 'account_expired' || result.error === 'session_expired' && result.reason === 'step_up') onExpired();
      };
      const style = host.current ? getComputedStyle(host.current) : null;
      const presentation = Object.fromEntries(['--guest-accent', '--guest-accent-fg', '--guest-bg', '--guest-card'].map(key => [key, style?.getPropertyValue(key).trim() ?? '']));
      iframe.current?.contentWindow?.postMessage({type: 'natzar:account-connect', nonce, presentation, draft: initialDraft}, new URL(frameUrl).origin, [channel.port2]);
    };
    window.addEventListener('message', ready);
    return () => {active = false; clearTimeout(timer); shell.dismiss(); port?.close(); bridge.current = null; window.removeEventListener('message', ready);};
  }, [attempt, client, frameUrl, locale, nonce, onExpired, initialDraft, onDraftChange]);
  return <div ref={host} className="guest-account-frame">
    {status === 'ready' && <button type="button" className="guest-account-history" aria-label={copy.history} title={copy.history} onClick={() => bridge.current?.postMessage({type: 'history'})}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2"/></svg></button>}
    <div ref={overlay}><div ref={panel}><iframe key={attempt} ref={iframe} title={copy.history} src={url.href} allow="camera; microphone; autoplay; fullscreen; clipboard-write" referrerPolicy="no-referrer"/></div></div>
    {status !== 'ready' && <div className="guest-account-loading" role="status"><p>{status === 'loading' ? copy.loading : copy.failed}</p>{status === 'error' && <button className="guest-secondary" onClick={() => setAttempt(value => value + 1)}>{copy.retry}</button>}</div>}
  </div>;
}
