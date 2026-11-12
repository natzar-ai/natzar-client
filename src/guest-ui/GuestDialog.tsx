// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useLayoutEffect, useRef, useState, type ReactNode, type RefObject} from 'react';
export function GuestDialog({id, purpose, step, title, why, closeLabel, onClose, panel, scroll, heading, blocked, symbol, footer, children, fitWhy = false}: {
  id: string; purpose: string; step: string; title: string; why: ReactNode; closeLabel: string; onClose(): void;
  panel: RefObject<HTMLDivElement | null>; scroll: RefObject<HTMLDivElement | null>; heading: RefObject<HTMLHeadingElement | null>;
  fitWhy?: boolean; blocked: boolean; symbol?: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  const introduction = useRef<HTMLParagraphElement>(null);
  const [showWhy, setShowWhy] = useState(true), [consentSpace, setConsentSpace] = useState(false), [tightTitle, setTightTitle] = useState(false);
  useLayoutEffect(() => {
    if (!fitWhy || !why) {setShowWhy(true); setConsentSpace(false); setTightTitle(false); return;}
    const body = scroll.current, paragraph = introduction.current, card = panel.current;
    if (!body || !paragraph || !card) return;
    const shade = card.parentElement!;
    const fit = () => {
      // Allocate optional copy and spacing from the frame's fixed height, never
      // from the flex child's temporarily expanded height while measuring.
      const hidden = paragraph.hidden, spacing = card.dataset.consentSpace, tight = card.dataset.tightTitle;
      delete card.dataset.consentSpace; delete card.dataset.tightTitle; paragraph.hidden = false;
      const shadeStyle = getComputedStyle(shade), cardStyle = getComputedStyle(card), whyStyle = getComputedStyle(paragraph);
      const footer = card.querySelector<HTMLElement>('.guest-signup-footer');
      const capacity = shade.clientHeight - parseFloat(shadeStyle.paddingTop) - parseFloat(shadeStyle.paddingBottom)
        - parseFloat(cardStyle.borderTopWidth) - parseFloat(cardStyle.borderBottomWidth) - (footer?.getBoundingClientRect().height ?? 0);
      const fullHeight = body.scrollHeight;
      const fits = fullHeight <= capacity + 1;
      const baseHeight = fullHeight - (fits ? 0 : paragraph.getBoundingClientRect().height + parseFloat(whyStyle.marginTop) + parseFloat(whyStyle.marginBottom));
      const needsTightTitle = baseHeight > capacity + 1;
      const roomForSpace = baseHeight - (needsTightTitle ? 8 : 0) + 6 <= capacity + 1;
      if (spacing === undefined) delete card.dataset.consentSpace; else card.dataset.consentSpace = spacing;
      if (tight === undefined) delete card.dataset.tightTitle; else card.dataset.tightTitle = tight;
      paragraph.hidden = hidden;
      setTightTitle(current => current === needsTightTitle ? current : needsTightTitle);
      setConsentSpace(current => current === roomForSpace ? current : roomForSpace);
      setShowWhy(current => current === fits ? current : fits);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(shade);
    observer.observe(body);
    const form = body.querySelector('form');
    if (form) observer.observe(form);
    return () => observer.disconnect();
  }, [fitWhy, why, step, scroll, panel]);
  const visibleWhy = !!why && (!fitWhy || showWhy);
  return <div className="guest-history-shade" data-open="true"
    onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); onClose();}}}>
    <div ref={panel} className="guest-history-dialog" role="dialog" aria-labelledby={id + '-title'} aria-describedby={visibleWhy ? id + '-why' : undefined} data-tight-title={tightTitle || undefined} data-consent-space={consentSpace || undefined} data-history-step={step} data-purpose={purpose}>
      <button type="button" className="guest-history-close" aria-label={closeLabel} onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      <div ref={scroll} className="guest-history-content" inert={blocked} aria-hidden={blocked || undefined}>
        {symbol && <div className="guest-history-symbol" aria-hidden="true">{symbol}</div>}
        <h2 ref={heading} tabIndex={-1} id={id + '-title'}>{title}</h2>{why && <p ref={introduction} hidden={!visibleWhy} id={id + '-why'} className="guest-history-why" data-fit={fitWhy || undefined}>{why}</p>}{children}
      </div>{footer}
    </div>
  </div>;
}
