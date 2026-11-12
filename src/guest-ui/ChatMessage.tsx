// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import type {ComponentPropsWithoutRef, ReactNode} from 'react';

export function ChatEmergencyAlert({children, style, ...props}: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} data-nz-emergency-reply="" role="alert" style={{
    margin: '8px 0', padding: '12px 14px', border: '2px solid #c0392b', borderRadius: 12,
    background: '#fdecea', color: '#7d2318', fontSize: 14.5, fontWeight: 500, lineHeight: 1.5,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...style,
  }}>{children}</div>;
}

export function ChatDay({iso, locale, sticky}: {iso: string; locale: string; sticky?: boolean}) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // UTC day numbers preserve calendar-day distance across daylight saving changes.
  const dayNumber = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;
  const days = dayNumber(date) - dayNumber(new Date());
  const label = days === 0 || days === -1
    ? new Intl.RelativeTimeFormat(locale, {numeric: 'auto'}).format(days, 'day')
    : date.toLocaleDateString(locale, {day: 'numeric', month: 'short', year: 'numeric'});
  return <div style={{margin: '12px 0', display: 'flex', justifyContent: 'center',
    ...(sticky ? {position: 'sticky', top: 0, zIndex: 1} : {})}}>
    <span style={{borderRadius: 999, padding: '4px 12px', fontSize: 11.5, fontWeight: 500,
      background: 'var(--nz-chip, #eae7e0)', color: 'var(--nz-muted, #5b6470)'}}>
      {label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)}
    </span>
  </div>;
}

export function ChatBubble({mine, runEnds, pending, sentAt, locale, children, style, ...props}:
  ComponentPropsWithoutRef<'div'> & {mine: boolean; runEnds: boolean; pending?: boolean; sentAt: string; locale: string}) {
  const radius = 'var(--nz-radius, 18px)';
  const date = new Date(sentAt);
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'});
  return <div style={{display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: runEnds ? 8 : 2}}>
    <div {...props} data-nz-chat-bubble="" style={{
      maxWidth: '85%', minWidth: 0, padding: '8px 12px', fontSize: 14.5, lineHeight: 1.45,
      boxShadow: '0 1px 1px rgba(0,0,0,0.08)',
      background: mine ? 'var(--nz-accent, #111111)' : 'var(--nz-incoming, #fff)',
      color: mine ? 'var(--nz-accent-fg, #fff)' : 'var(--nz-fg, #111111)',
      borderTopLeftRadius: radius, borderTopRightRadius: radius,
      borderBottomLeftRadius: runEnds && !mine ? 4 : radius, borderBottomRightRadius: runEnds && mine ? 4 : radius,
      ...style,
    }}>
      {children}
      <div style={{marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontVariantNumeric: 'tabular-nums',
        justifyContent: mine ? 'flex-end' : 'flex-start', color: mine ? 'inherit' : 'var(--nz-muted, #5b6470)', opacity: mine ? 0.75 : 0.9}}>
        <time dateTime={sentAt}>{time}</time>
        {mine && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={pending ? 'Sending' : 'Sent'} style={{flexShrink: 0}}>
          {pending ? <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></> : <path d="m20 6-11 11-5-5"/>}
        </svg>}
      </div>
    </div>
  </div>;
}

export function ChatMessageText({children}: {children: ReactNode}) {
  return <p style={{margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{children}</p>;
}

const imageExtension = /\.(jpe?g|png|webp|gif|heic|heif)$/i;

export function ChatAttachment({fileName, url, onImageLoad, className}: {
  fileName: string; url?: string; onImageLoad?: () => void; className?: string;
}) {
  if (url && imageExtension.test(fileName)) return <img className={className} src={url} alt={fileName} onLoad={onImageLoad}
    style={{display: 'block', marginBottom: 6, maxHeight: 260, width: '100%', objectFit: 'cover', borderRadius: 'calc(var(--nz-radius, 18px) - 6px)'}}/>;
  const style = {display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 13, overflowWrap: 'anywhere'} as const;
  const content = <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink: 0}}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48"/>
  </svg><span>{fileName}</span></>;
  return url
    ? <a className={className} href={url} target="_blank" rel="noopener noreferrer"
        style={{...style, color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2}}>{content}</a>
    : <span className={className} style={style}>{content}</span>;
}
