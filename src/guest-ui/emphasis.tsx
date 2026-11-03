// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
// The assistant writes Markdown-flavoured prose — its plans and advice arrive
// with `**bold**` headings ("**Immediate relief:**") because that is how an LLM
// marks up a list of steps. Nothing downstream parses it, so the patient read
// the asterisks as literal punctuation.
//
// This renders that ONE construct and nothing else. A full Markdown renderer
// in a chat bubble is a liability: the same pipeline carries physician-typed
// prose and patient-quoted text, and a parser that also owns links, images and
// raw HTML is a much larger surface than "make the emphasis look emphasized".
import type {ReactNode} from "react";

/**
 * A `**bold**` run, on ONE line.
 *
 * Bounded by non-space on both sides, as Markdown requires: it stops "2 * 3 *
 * 4" style arithmetic and a dangling `**` from swallowing the rest of the
 * message. Line-bounded for the same reason — an unclosed marker then costs at
 * most its own line instead of reaching across paragraphs to the next one.
 */
const BOLD = /\*\*(\S(?:[^\n]*?\S)?)\*\*/g;

/**
 * Message text with `**bold**` rendered as bold, everything else verbatim.
 *
 * Returns the plain string untouched when there is no markup, so the common
 * case allocates nothing and keeps rendering as a single text node.
 */
export function renderEmphasis(text: string): ReactNode {
  if (!text.includes("**")) return text;

  const out: ReactNode[] = [];
  let last = 0;
  // A fresh RegExp per call: BOLD is global, and a shared one carries
  // `lastIndex` between calls, so every other message would start mid-string.
  const pattern = new RegExp(BOLD.source, "g");

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      <strong key={match.index} className="font-semibold">
        {match[1]}
      </strong>,
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}
