// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useEffect, useRef, useState} from 'react';
import type {GuestClient} from '../guest/index';
import type {GuestCareOffer} from '../contract/guest';
import {loginCopy} from './login-copy';
import {createPatientFrameShell} from './payment-dialog';

/** The existing patient surface stays isolated in its own document. Only RPC crosses the frame. */
export function GuestAccountFrame({client, frameUrl, locale, onExpired, draft = '', onDraftChange, inert, careOffer, onCareOffer}: {
  client: GuestClient; frameUrl: string; locale: string; onExpired(): void; draft?: string; onDraftChange?(value: string): void; inert?: boolean;
  careOffer?: GuestCareOffer; onCareOffer(messageId: string): Promise<boolean>;
}) {
  const iframe = useRef<HTMLIFrameElement>(null), host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const initialDraft = useRef(draft).current;
  const offer = useRef({careOffer, onCareOffer});
  offer.current = {careOffer, onCareOffer};
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
      const channel = new MessageChannel(); port = channel.port1;
      port.onmessage = async message => {
        const request = message.data as {id?: string; operation?: string; input?: Record<string, unknown>; type?: string; name?: string; detail?: {phase?: string}; draft?: string};
        if (request.type === 'draft' && typeof request.draft === 'string') {onDraftChange?.(request.draft.slice(0, 2000)); return;}
        if (request.type === 'event' && request.name === 'payment') {
          if (request.detail?.phase === 'started' && iframe.current) shell.present(iframe.current, locale); else shell.dismiss();
          return;
        }
        if (request.type === 'mounted') {clearTimeout(timer); if (active) setStatus('ready'); return;}
        if (typeof request.id !== 'string' || typeof request.operation !== 'string' || !client.accountOperation) return;
        if (request.operation === 'openGuestCareOffer') {
          const messageId = request.input?.messageId, current = offer.current.careOffer;
          let ok = false;
          if (current && messageId === current.messageId && current.available && Date.parse(current.expiresAt) > Date.now()) {
            // Check the authenticated transcript before continuing a guest
            // assessment. A later patient turn belongs to member triage.
            const latest = await client.accountOperation('embedAgentMessages', {after: current.messageId});
            if (active && latest.error === 'account_expired') onExpired();
            if (active && latest.ok && !latest.hasMore && Array.isArray(latest.messages) &&
              !latest.messages.some(message => message?.author === 'patient' || message?.id === current.messageId)) {
              ok = await offer.current.onCareOffer(current.messageId);
            }
          }
          if (active) port?.postMessage({id: request.id, result: {ok}});
          return;
        }
        const result = await client.accountOperation(request.operation, request.input ?? {});
        if (!active) return;
        port?.postMessage({id: request.id, result: request.operation === 'embedAgentMessages' && result.ok
          ? {...result, guestCareOffer: offer.current.careOffer ?? null} : result});
        if (result.error === 'account_expired' || result.error === 'session_expired' && result.reason === 'step_up') onExpired();
      };
      const style = host.current ? getComputedStyle(host.current) : null;
      const presentation = Object.fromEntries(['--guest-accent', '--guest-accent-fg', '--guest-bg', '--guest-card'].map(key => [key, style?.getPropertyValue(key).trim() ?? '']));
      iframe.current?.contentWindow?.postMessage({type: 'natzar:account-connect', nonce, presentation, draft: initialDraft}, new URL(frameUrl).origin, [channel.port2]);
    };
    window.addEventListener('message', ready);
    return () => {active = false; clearTimeout(timer); shell.dismiss(); port?.close(); window.removeEventListener('message', ready);};
  }, [attempt, client, frameUrl, locale, nonce, onExpired, initialDraft, onDraftChange]);
  return <div ref={host} className="guest-account-frame" inert={inert}>
    <div ref={overlay}><div ref={panel}><iframe key={attempt} ref={iframe} title={copy.history} src={url.href} allow="camera; microphone; autoplay; fullscreen; clipboard-write" referrerPolicy="no-referrer"/></div></div>
    {status !== 'ready' && <div className="guest-account-loading" role="status"><p>{status === 'loading' ? copy.loading : copy.failed}</p>{status === 'error' && <button className="guest-secondary" onClick={() => setAttempt(value => value + 1)}>{copy.retry}</button>}</div>}
  </div>;
}
