// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import type {ReactNode} from 'react';
import {ChatAttachment, ChatBubble, ChatMessageText} from './ChatMessage';
import {renderEmphasis} from './emphasis';
import {MEMBERSHIP_LINK, safeAttachmentUrl, stripLink} from './links';

export type ThreadMessage = {
  id: string;
  author: 'patient' | 'agent' | 'physician' | 'system';
  body: string;
  sentAt: string;
  emergency?: boolean;
  signature?: string;
  attachments?: {id?: string; fileName: string; url?: string}[];
  /** True while the server has yet to acknowledge the patient's submission. */
  pending?: boolean;
};

export function MessageBubble({message, mine, runStarts, runEnds, locale, physicianLabel, attachmentLabel,
  onImageLoad, className, attachmentClassName, resolveAttachmentUrl = safeAttachmentUrl, children}: {
  message: ThreadMessage;
  mine: boolean;
  runStarts: boolean;
  runEnds: boolean;
  locale: string;
  physicianLabel: string;
  attachmentLabel: string;
  onImageLoad?: () => void;
  className?: string;
  attachmentClassName?: string;
  resolveAttachmentUrl?: (url?: string) => string | null;
  children?: ReactNode;
}) {
  const membershipUrl = MEMBERSHIP_LINK.exec(message.body)?.[0];
  return <ChatBubble mine={mine} runEnds={runEnds} pending={message.pending} sentAt={message.sentAt}
    locale={locale} className={className} data-role={mine ? 'user' : 'assistant'}>
    {!mine && runStarts && message.author === 'physician' &&
      <p style={{margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--nz-accent)',
        fontSize: 12.5, fontWeight: 600}}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink: 0}}>
          <path d="M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1M8 15a6 6 0 0 0 12 0v-3"/>
          <circle cx="20" cy="10" r="2"/>
        </svg>
        {message.signature ?? physicianLabel}
      </p>}
    {message.attachments?.map(attachment => {
      const url = resolveAttachmentUrl(attachment.url) ?? undefined;
      return <ChatAttachment key={attachment.id ?? attachment.url ?? attachment.fileName} className={attachmentClassName}
        url={url} fileName={attachment.url && !url ? attachmentLabel : attachment.fileName} onImageLoad={onImageLoad}/>;
    })}
    {message.body && <ChatMessageText>{renderEmphasis(stripLink(message.body))}</ChatMessageText>}
    {membershipUrl && <a href={membershipUrl} target="_blank" rel="noopener noreferrer" style={{
      display: 'inline-block', marginTop: 8, borderRadius: 8, padding: '8px 12px', fontWeight: 600,
      textDecoration: 'underline', background: 'var(--nz-chip)',
    }}>View AI membership</a>}
    {children}
  </ChatBubble>;
}

export function SystemChip({children}: {children: ReactNode}) {
  const content = typeof children === 'string' ? renderEmphasis(stripLink(children)) : children;
  return <div style={{margin: '6px 0', display: 'flex', justifyContent: 'center'}}>
    <span style={{maxWidth: '85%', borderRadius: 16, padding: '6px 14px', textAlign: 'center',
      fontSize: 12.5, lineHeight: 1.45, background: 'var(--nz-chip)', color: 'var(--nz-muted)'}}>
      {content}
    </span>
  </div>;
}
