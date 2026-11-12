// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useCallback, useEffect, useRef, type ComponentProps, type ComponentPropsWithoutRef, type Dispatch, type ReactNode, type RefObject, type SetStateAction} from 'react';
import {AgentHeader, AgentThread, AgentTyping, AgentWelcome} from './AgentWelcome';
import {ChatComposer, MAX_UPLOAD_BYTES} from './ChatComposer';
import {ChatDay, ChatEmergencyAlert} from './ChatMessage';
import {MessageBubble, SystemChip, type ThreadMessage} from './ChatTranscript';
import {chatCopy} from './chat-copy';
import {groupByDay} from './chat-dates';
import {useKeepNewestInView} from './chat-scroll';

export type ChatSubmissionResult = 'sent' | 'failed' | 'superseded';
type ComposerProps = Omit<ComponentProps<typeof ChatComposer>, 'labels' | 'placeholder' | 'onSend' | 'onDraft' | 'onFile'> & {
  onDraft: Dispatch<SetStateAction<string>>;
  onFile: Dispatch<SetStateAction<File | null>>;
  onError: (message: string) => void;
  submit: (text: string, file: File | null) => Promise<ChatSubmissionResult>;
  scope?: object;
  isCurrent?: () => boolean;
};
type BubbleProps = ComponentProps<typeof MessageBubble>;

/** The patient conversation. Session owners provide the transcript and handle actions. */
export function AgentChat<Message extends ThreadMessage>({
  locale, heading, headerProps, messages, composer, awaiting, typingLabel, typingClassName, transcriptProps, transcriptRef,
  messageClassName, attachmentClassName, resolveAttachmentUrl, renderMessage, entry, afterMessages, afterTyping,
  showEmpty = true, showStart = false, scrollRevision, loading, overlay, footer,
}: {
  locale: string;
  heading: ReactNode;
  headerProps?: ComponentPropsWithoutRef<'header'>;
  messages: Message[];
  composer?: ComposerProps;
  awaiting?: boolean;
  typingLabel?: string;
  typingClassName?: string;
  transcriptProps?: ComponentPropsWithoutRef<'div'>;
  transcriptRef?: RefObject<HTMLDivElement | null>;
  messageClassName?: string;
  attachmentClassName?: string;
  resolveAttachmentUrl?: BubbleProps['resolveAttachmentUrl'];
  renderMessage?: (message: Message, bubble: BubbleProps) => ReactNode;
  entry?: ReactNode;
  afterMessages?: ReactNode;
  afterTyping?: ReactNode;
  showEmpty?: boolean;
  showStart?: boolean;
  scrollRevision?: unknown;
  loading?: ReactNode;
  overlay?: ReactNode;
  footer?: ReactNode;
}) {
  const labels = chatCopy(locale);
  const dateLocale = locale.replace(/_/g, '-');
  const localRef = useRef<HTMLDivElement>(null);
  const scrollRef = transcriptRef ?? localRef;
  const submitting = useRef<{scope?: object} | null>(null);
  useKeepNewestInView(scrollRef);

  const scrollToBottom = useCallback(() => {
    const thread = scrollRef.current;
    if (thread) thread.scrollTo({top: thread.scrollHeight, behavior: 'smooth'});
  }, [scrollRef]);

  const loaded = loading == null;
  useEffect(() => {
    if (showStart) scrollRef.current?.scrollTo({top: 0});
    else scrollToBottom();
  }, [messages, showStart, scrollRevision, loaded, scrollRef, scrollToBottom]);

  async function send() {
    if (!composer || composer.busy || (submitting.current && submitting.current.scope === composer.scope)) return;
    const {draft, file, onDraft, onFile, onError, submit, scope, isCurrent} = composer;
    const text = draft.trim();
    if (!text && !file) return;
    if (file && file.size > MAX_UPLOAD_BYTES) {
      onError(labels.chat.fileTooLarge);
      return;
    }

    const attempt = {scope};
    submitting.current = attempt;
    onDraft('');
    onFile(null);
    let result: ChatSubmissionResult = 'failed';
    try {
      result = await submit(text, file);
    } catch {
      if (submitting.current === attempt && (isCurrent?.() ?? true)) onError(labels.chat.sendFailed);
    } finally {
      if (submitting.current === attempt) {
        submitting.current = null;
        if (result === 'failed' && (isCurrent?.() ?? true)) {
          onDraft(current => current || text);
          onFile(current => current ?? file);
        }
      }
    }
  }

  return <div data-nz-agent-chat="" style={{display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0}}>
    <AgentHeader {...headerProps}>{heading}</AgentHeader>
    {loading ?? <AgentThread {...transcriptProps} ref={scrollRef} data-nz-transcript="" emergencyMessage={labels.agent.urgent}>
      {entry ?? <>
        {showEmpty && !messages.length && <AgentWelcome message={labels.agent.empty}/>}
        {groupByDay(messages).map(day => <div key={day[0].id}>
          <ChatDay iso={day[0].sentAt} locale={dateLocale} sticky/>
          {day.map((message, index) => {
            const role = message.author === 'patient' ? 'user' : 'assistant';
            if (message.emergency) return <ChatEmergencyAlert key={message.id} className={messageClassName}
              data-role={role}>{message.body}</ChatEmergencyAlert>;
            const previous = day[index - 1], next = day[index + 1];
            const bubble: BubbleProps = {
              message, mine: message.author === 'patient',
              runStarts: previous?.author !== message.author || previous.emergency === true,
              runEnds: next?.author !== message.author || next.emergency === true,
              locale: dateLocale, physicianLabel: labels.agent.physician, attachmentLabel: labels.chat.attachment,
              onImageLoad: scrollToBottom, className: messageClassName, attachmentClassName, resolveAttachmentUrl,
            };
            const custom = renderMessage?.(message, bubble);
            if (custom != null) return <div key={message.id}>{custom}</div>;
            if (message.author === 'system') return <SystemChip key={message.id}>{message.body}</SystemChip>;
            return <MessageBubble key={message.id} {...bubble}/>;
          })}
        </div>)}
      </>}
      {afterMessages}
      {awaiting && !messages.some(message => message.pending) && <AgentTyping className={typingClassName} label={typingLabel}/>}
      {afterTyping}
    </AgentThread>}
    {overlay}
    {composer && <ChatComposer draft={composer.draft} onDraft={composer.onDraft} file={composer.file} onFile={composer.onFile}
      busy={composer.busy} error={composer.error} inputRef={composer.inputRef} maxLength={composer.maxLength}
      onFocus={composer.onFocus} onBlur={composer.onBlur} extra={composer.extra}
      labels={labels.chat} placeholder={labels.agent.placeholder} onSend={() => void send()}/>}
    {footer}
  </div>;
}
