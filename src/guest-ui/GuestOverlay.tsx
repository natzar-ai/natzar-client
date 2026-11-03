// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useEffect, useId, useRef} from 'react';
import type {ReactNode} from 'react';
import {focusFormField} from './form-focus';

/**
 * The same in-frame takeover as EmbedPharmacy/EmbedAgent's call surface:
 * a Back bar and one scrolling body, while the host page remains interactive.
 * Keeping this mounted when hidden preserves an optional form's local draft.
 */
export function GuestOverlay({open, title, closeLabel, busy, requiredHint, dismissible = true, onClose, children}: {
  open: boolean; title: string; closeLabel: string; busy: boolean; requiredHint?: string; dismissible?: boolean;
  onClose(): void; children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId(), hintId = useId();
  useEffect(() => {if (open) focusFormField(heading.current);}, [open, title]);
  return <section className="guest-overlay" data-open={open ? 'true' : 'false'} hidden={!open} role="region"
    aria-labelledby={titleId} aria-describedby={requiredHint ? hintId : undefined}
    onKeyDown={event => {if (event.key === 'Escape' && dismissible && !busy) {event.preventDefault(); onClose();}}}>
    <button type="button" className="guest-overlay-back" disabled={busy} onClick={onClose}>← {closeLabel}</button>
    <div className="guest-overlay-body"><div className="guest-overlay-content">
      <h2 ref={heading} id={titleId} tabIndex={-1}>{title}</h2>
      {requiredHint && <p className="guest-overlay-required" id={hintId}>{requiredHint}</p>}
      {children}
    </div></div>
  </section>;
}
