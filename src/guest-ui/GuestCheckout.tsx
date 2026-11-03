// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {GuestPayment} from '../contract/guest';
import type {GuestCopy} from './copy';
import type {StripeEmbeddedCheckout} from '@stripe/stripe-js';
import {lockGuestScroll} from './modal-scroll';

function StripeCheckout({clientSecret, publishableKey, copy, onComplete}: {clientSecret: string; publishableKey: string; copy: GuestCopy; onComplete(): void}) {
  const target = useRef<HTMLDivElement>(null);
  const complete = useRef(onComplete); complete.current = onComplete;
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let checkout: StripeEmbeddedCheckout | null = null;
    void (async () => {
      try {
        const {loadStripe} = await import('@stripe/stripe-js/pure');
        const stripe = await loadStripe(publishableKey);
        if (!stripe) throw new Error('Checkout unavailable');
        const instance = await stripe.createEmbeddedCheckoutPage({clientSecret, onComplete: () => {if (!cancelled) complete.current();}});
        if (cancelled) {instance.destroy(); return;}
        checkout = instance;
        if (target.current) instance.mount(target.current);
      } catch {if (!cancelled) setError(true);}
    })();
    return () => {cancelled = true; checkout?.destroy();};
  }, [clientSecret, publishableKey, attempt]);
  return <div className="guest-checkout">{error && <><p className="guest-payment-error" role="alert">{copy.checkoutError}</p><button type="button" className="guest-payment-action" onClick={() => {setError(false); setAttempt(value => value + 1);}}>{copy.paymentRetry}</button></>}<div ref={target}/></div>;
}

const paymentStyles = `
.natzar-guest-payment{position:fixed;inset:0;margin:auto;border:0;padding:0;width:min(760px,calc(100vw - 32px));width:min(760px,calc(100dvw - 32px));height:min(900px,calc(100vh - 32px));height:min(900px,calc(100dvh - 32px));max-width:none;max-height:none;border-radius:16px;overflow:hidden;background:var(--nz-card,#fff);color:var(--nz-fg,#111);font:15px/1.55 var(--nz-font,Inter,Geist,system-ui,-apple-system,sans-serif);box-shadow:0 24px 64px rgba(15,23,42,.32);box-sizing:border-box}
.natzar-guest-payment[open]{animation:guest-payment-rise .2s ease both}.natzar-guest-payment::backdrop{background:rgba(15,23,42,.55);animation:guest-payment-fade .2s ease both}.natzar-guest-payment *{box-sizing:border-box}.natzar-guest-payment button,.natzar-guest-payment a{font:inherit;touch-action:manipulation}.natzar-guest-payment button{cursor:pointer}.natzar-guest-payment button:disabled{cursor:wait;opacity:.4}.natzar-guest-payment :focus-visible{outline:3px solid var(--nz-accent,#111);outline-offset:3px}
.natzar-guest-payment .guest-payment-shell{height:100%;display:flex;flex-direction:column}.natzar-guest-payment .guest-payment-back{flex:none;width:100%;border:0;border-bottom:1px solid var(--nz-border,#e2ddd3);padding:10px 16px;background:var(--nz-card,#fff);color:var(--nz-accent,#111);text-align:left;font-size:13px}.natzar-guest-payment .guest-payment-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px}.natzar-guest-payment .guest-payment-content{width:100%;max-width:560px;margin:auto}.natzar-guest-payment h2{font-size:18px;font-weight:600;line-height:1.4;margin:0 0 16px;outline:none}.natzar-guest-payment p{font-size:14px;color:var(--nz-muted,#5b6470);margin:0 0 16px}.natzar-guest-payment .guest-payment-provider{margin:16px 0}.natzar-guest-payment .guest-payment-action{display:block;width:100%;border:1px solid var(--nz-border,#e2ddd3);border-radius:10px;min-height:44px;padding:10px 16px;background:var(--nz-card,#fff);color:var(--nz-fg,#111);text-align:center;text-decoration:none;margin:12px 0}.natzar-guest-payment .guest-payment-action-primary{border-color:var(--nz-accent,#111);background:var(--nz-accent,#111);color:var(--nz-accent-fg,#fff)}.natzar-guest-payment .guest-payment-error{padding:12px;background:#fef0ed;border-radius:9px;color:#a93636}.natzar-guest-payment [role=status]{color:var(--nz-muted,#5b6470)}
@media(max-width:640px){.natzar-guest-payment{inset:auto 0 0;margin:0;width:100vw;width:100dvw;height:94vh;height:94dvh;border-radius:16px 16px 0 0}}
@media(prefers-reduced-motion:reduce){.natzar-guest-payment[open],.natzar-guest-payment::backdrop{animation:none}}
@keyframes guest-payment-rise{from{opacity:0;transform:translateY(12px)}}@keyframes guest-payment-fade{from{opacity:0}}
`;

/** Same bounded desktop dialog and phone sheet as the registered patient payment step. */
export function GuestCheckout({payment, copy, busy, allowPayment = true, onBack, onCheck, onComplete}: {
  payment?: GuestPayment; copy: GuestCopy; busy: boolean; allowPayment?: boolean;
  onBack(): void; onCheck(): void; onComplete(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const source = useRef<HTMLSpanElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [settling, setSettling] = useState(false);
  const settlingRef = useRef(false);
  const back = useRef(onBack); back.current = onBack;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const doc = node.ownerDocument;
    const sourceRoot = source.current?.getRootNode() as Document | ShadowRoot | undefined;
    const active = sourceRoot?.activeElement ?? doc.activeElement;
    const previous = active instanceof HTMLElement ? active : null;
    // The portal is outside the widget, including its shadow root. Carry the
    // same clinic theme into the modal before it enters the top layer.
    if (source.current && doc.defaultView) {
      const theme = doc.defaultView.getComputedStyle(source.current);
      for (const [token, fallback] of [['--nz-card', '--guest-card'], ['--nz-fg', '--guest-ink'], ['--nz-muted', '--guest-muted'], ['--nz-border', '--guest-line'], ['--nz-accent', '--guest-accent'], ['--nz-accent-fg', '--guest-accent-fg'], ['--nz-font', '']]) {
        const value = theme.getPropertyValue(token).trim() || (fallback ? theme.getPropertyValue(fallback).trim() : token === '--nz-font' ? theme.fontFamily : '');
        if (value) node.style.setProperty(token, value);
      }
    }
    const unlock = lockGuestScroll(doc);
    node.showModal();
    heading.current?.focus({preventScroll: true});
    return () => {
      if (node.open) node.close();
      unlock();
      if (previous?.isConnected) previous.focus({preventScroll: true});
    };
  }, []);
  let checkoutUrl: string | null = null;
  try {
    if (payment?.checkoutUrl) {
      const url = new URL(payment.checkoutUrl);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) checkoutUrl = url.href;
    }
  } catch { /* A malformed provider URL must never become a navigation. */ }
  if (typeof document === 'undefined') return null;
  const submitted = () => {settlingRef.current = true; setSettling(true); onComplete();};
  return <><span ref={source} hidden aria-hidden="true"/>{createPortal(<>
    <style>{paymentStyles}</style>
    <dialog ref={dialog} className="natzar-guest-payment" aria-label={copy.paymentTitle} aria-modal="true" data-payment-settling={settling}
      onCancel={event => {event.preventDefault(); if (!settlingRef.current && !busyRef.current) back.current();}}>
      <div className="guest-payment-shell">
        <button type="button" className="guest-payment-back" disabled={busy || settling} onClick={onBack}>← {copy.backChat}</button>
        <main className="guest-payment-scroll"><div className="guest-payment-content">
          <h2 ref={heading} tabIndex={-1}>{copy.paymentTitle}</h2>
          <p>{copy.paymentBody}</p>
          {settling ? <p role="status">{copy.waiting}</p> : <>
            {allowPayment && payment?.status === 'pending' && payment.clientSecret && payment.publishableKey && <div className="guest-payment-provider"><StripeCheckout clientSecret={payment.clientSecret} publishableKey={payment.publishableKey} copy={copy} onComplete={submitted}/></div>}
            {allowPayment && checkoutUrl && <a className="guest-payment-action guest-payment-action-primary" href={checkoutUrl} target="_blank" rel="noopener noreferrer">{copy.openCheckout}</a>}
          </>}
          <button type="button" className="guest-payment-action" disabled={busy} onClick={onCheck}>{busy ? copy.busy : copy.checkPayment}</button>
          {!settling && payment?.status === 'pending' && <p role="status">{copy.waiting}</p>}
        </div></main>
      </div>
    </dialog>
  </>, document.body)}</>;
}
