// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useEffect, useRef, type ReactNode, type RefObject} from "react";

// The message composer — attachment picker, growing textarea, send — shared by
// the agent chat and the conversation panel inside a video call, so the two
// cannot drift into being "almost the same box".
//
// Deliberately stateless: the draft, the staged file and the in-flight/error
// state all belong to whichever surface owns the sending. This owns the layout
// and the keyboard contract (Enter sends, Shift+Enter breaks a line).

/** Mirrors embed-api's MAX_ATTACHMENT_UPLOAD_BYTES default. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** What the composer accepts, matching the server's allow-list. */
const ACCEPT = "image/*,.pdf,.csv,.txt,.docx,.xlsx";

export function ChatComposer({
  draft,
  onDraft,
  file,
  onFile,
  busy,
  error,
  placeholder,
  onSend,
  labels, inputRef, onFocus, onBlur, maxLength, extra,
}: {
  draft: string;
  onDraft: (value: string) => void;
  file: File | null;
  onFile: (file: File | null) => void;
  /** A send is in flight: the controls lock and the button spins. */
  busy: boolean;
  error?: string | null;
  placeholder: string;
  onSend: () => void;
  labels: {attach: string; removeAttachment: string; send: string};
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onFocus?: () => void;
  onBlur?: () => void;
  maxLength?: number;
  extra?: ReactNode;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? localRef;

  // Grow with the draft up to the CSS max-height, then — and only then — hand
  // off to the textarea's own scrollbar.
  //
  // Two things here are deliberate, both of which were bugs when they weren't:
  //
  //  - The border is read from computed styles, NOT from
  //    `offsetHeight - clientHeight`. That difference is borders PLUS any
  //    horizontal scrollbar, so the moment one appears (a narrow frame wrapping
  //    the placeholder is enough) it reads ~17px instead of 2 — and since the
  //    result is fed straight back into `height`, the box ratchets taller on
  //    every keystroke. Measured climbing 367px → 382px on an EMPTY field.
  //
  //  - Overflow is driven, not left on. With `overflow-y: auto` standing, any
  //    disagreement between the content and the box — sub-pixel rounding, a
  //    wrapped placeholder, a mount that happened before layout — shows a
  //    scrollbar on a field with nothing in it. Keeping it hidden until the
  //    cap is genuinely reached means a scrollbar can only ever mean "there is
  //    more text than fits".
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    // An EMPTY field is never measured. `scrollHeight` on an empty textarea
    // reports the wrapped PLACEHOLDER, so in a narrow frame the hint text runs
    // to several lines and the box grows to fit it — an empty composer three
    // rows tall with a scrollbar in it, which is the bug this guard exists for.
    // A placeholder is a hint, not content: it gets clipped, it never sizes the
    // box and it never earns a scrollbar.
    if (!draft) {
      el.style.height = "";
      el.style.overflowY = "hidden";
      return;
    }

    const style = getComputedStyle(el);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const maxHeight = parseFloat(style.maxHeight);

    el.style.height = "auto";
    // scrollHeight is content + padding; the box is border-box (Tailwind's
    // preflight), so the height has to cover the border too.
    const wanted = el.scrollHeight + (Number.isFinite(border) ? border : 0);
    const capped = Number.isFinite(maxHeight) ? Math.min(wanted, maxHeight) : wanted;
    el.style.height = `${capped}px`;
    el.style.overflowY = wanted > capped ? "auto" : "hidden";
  }, [draft, textareaRef]);

  // A cleared attachment must clear the INPUT too, or picking the same file
  // again fires no `change` event and the paperclip looks broken.
  useEffect(() => {
    if (!file && fileInputRef.current) fileInputRef.current.value = "";
  }, [file]);

  return (
    <div
      // Pinned to the frame's bottom edge (the transcript above takes the rest), above the iOS home indicator.
      className="nz-composer"
      data-nz-bottom=""
      style={{borderColor: "var(--nz-border, #e2ddd3)", background: "var(--nz-card, #fff)"}}
    >
      <style>{composerStyles}</style>
      {error && (
        <p className="nz-composer-error" role="alert">
          {error}
        </p>
      )}
      {file && (
        <div
          className="nz-composer-file"
          style={{background: "var(--nz-chip, #eae7e0)", color: "var(--nz-muted, #5b6470)"}}
        >
          <span className="nz-composer-filename">{file.name}</span>
          <button type="button" aria-label={labels.removeAttachment} onClick={() => onFile(null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>
          </button>
        </div>
      )}
      <div className="nz-composer-row">
        {extra}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          aria-label={labels.attach}
          className="nz-composer-attach"
          style={{color: "var(--nz-muted, #5b6470)"}}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 0 1-2.8-2.8l9.2-9.2"/></svg>
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          maxLength={maxLength}
          rows={1}
          placeholder={placeholder}
          aria-label={placeholder}
          className="nz-composer-input"
          style={{background: "var(--nz-bg, #f6f5f2)", borderColor: "var(--nz-border, #e2ddd3)", color: "var(--nz-fg, #111111)"}}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={busy || (!draft.trim() && !file)}
          aria-label={labels.send}
          className="nz-composer-send"
          style={{color: "var(--nz-accent-fg, #fff)"}}
        >
          {busy ? <svg className="nz-composer-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3a9 9 0 1 1-9 9"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 3 3 9-3 9 19-9Z"/><path d="M6 12h16"/></svg>}
        </button>
      </div>
    </div>
  );
}

const composerStyles = `
.nz-composer{flex-shrink:0;border-top:1px solid;padding:12px 12px max(12px,env(safe-area-inset-bottom));box-sizing:border-box}
.nz-composer-row{display:flex;align-items:flex-end;gap:8px;max-width:560px;margin:0 auto}
.nz-composer button{font:inherit;cursor:pointer;border:0;padding:0}.nz-composer button:disabled{opacity:.4;cursor:default}
.nz-composer-attach,.nz-composer-send{display:flex;align-items:center;justify-content:center;width:40px;height:40px;flex-shrink:0;border-radius:50%;transition:background-color .15s}
.nz-composer-attach{background:var(--nz-chip, #eae7e0)}.nz-composer-attach:enabled:hover{background:var(--nz-chip-hover,var(--nz-chip, #eae7e0))}
.nz-composer-send{background:var(--nz-accent, #111111)}.nz-composer-send:enabled:hover{background:var(--nz-accent-hover,var(--nz-accent, #111111))}
.nz-composer .nz-composer-input{box-sizing:border-box;min-width:0;max-height:128px;min-height:40px;flex:1;resize:none;overflow-y:hidden;border:1px solid;border-radius:16px;padding:10px 14px;font:inherit;font-size:14.5px;line-height:1.4;outline:none}
.nz-composer-file{max-width:560px;margin:0 auto 8px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-radius:8px;padding:6px 12px;font-size:13px}
.nz-composer-filename{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nz-composer-file button{background:none;color:inherit;display:grid;place-items:center;min-width:28px;min-height:28px}
.nz-composer-error{max-width:560px;margin:0 auto 8px;font-size:13px;font-weight:500;color:#c0392b}
.nz-composer-spinner{animation:nz-composer-spin 1s linear infinite}@keyframes nz-composer-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.nz-composer-spinner{animation:none}}
`;
