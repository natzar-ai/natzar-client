/**
 * Turning the links the platform writes into transcripts into ACTIONS.
 *
 * The messaging services emit exactly two URL shapes:
 *
 * ```
 * <host>/async?id=<consultId>        the consent invite AND the rating invite
 * <host>/telehealth?id=<consultId>   the video invite
 * ```
 *
 * They exist because SMS and WhatsApp have nothing but text. Inside an app —
 * yours or ours — a URL is the wrong answer twice over: it navigates the
 * patient out, and the destination is our own anonymous page, which re-asks
 * for a date of birth you already authenticated. So a client should strip the
 * link from the body and render a BUTTON.
 *
 * The catch, and the reason this module is not four lines: the `/async` shape
 * is reused for two different intents, so the URL alone cannot tell you
 * whether the button says "Accept" or "Rate". Only the consult's current state
 * can. {@link resolveLinkActions} resolves that with the ids it found —
 * exactly what our own embedded widget does server-side before it paints, so a
 * headless integration reaches the same UI.
 *
 * @packageDocumentation
 */

import type {NatzarClient} from './client';
import type {AsyncConsultResource, MessageResource, TelehealthConsultResource} from './contract/resources';
import {isNatzarApiError} from './errors';

/**
 * What a link can currently be used for.
 *
 * The terminal states are distinct rather than one "nothing to do", because
 * the right UI keeps the button VISIBLE and disabled with a label saying what
 * happened. A control that disappears after a tap leaves the patient unsure
 * whether it registered; one that reads "Rated" answers the question.
 *
 * - `consent` / `rate` / `join` — actionable.
 * - `open`  — the consult is live and the conversation itself is the surface;
 *   there was never a button here.
 * - `rated` — already rated (disabled, "Rated").
 * - `ended` — finished with nothing left to do (disabled).
 * - `none`  — unresolved. We could not read the consult, and inventing a label
 *   for an unknown state would be worse than saying nothing.
 */
export type LinkAction = 'consent' | 'rate' | 'join' | 'open' | 'rated' | 'ended' | 'none';

/** Actions the patient can still perform. Everything else renders disabled. */
export function isActionable(action: LinkAction): boolean {
  return action === 'consent' || action === 'rate' || action === 'join';
}

/** A link found in a message body. */
export interface DetectedLink {
  kind: 'async' | 'telehealth';
  consultId: string;
}

/** Resolved state for every consult referenced across a transcript. */
export type LinkActions = Record<string, {kind: 'async' | 'telehealth'; action: LinkAction}>;

const ASYNC_LINK = /\S*\/async\?id=([A-Za-z0-9_-]+)\S*/;
const TELEHEALTH_LINK = /\S*\/telehealth\?id=([A-Za-z0-9_-]+)\S*/;
const ASYNC_LINK_GLOBAL = /\/async\?id=([A-Za-z0-9_-]+)/g;
const TELEHEALTH_LINK_GLOBAL = /\/telehealth\?id=([A-Za-z0-9_-]+)/g;

/** The consult a message body links to, if any. */
export function detectLink(body: string): DetectedLink | null {
  const asyncMatch = ASYNC_LINK.exec(body);
  if (asyncMatch) return {kind: 'async', consultId: asyncMatch[1]};
  const tele = TELEHEALTH_LINK.exec(body);
  if (tele) return {kind: 'telehealth', consultId: tele[1]};
  return null;
}

/**
 * The prose without the URL.
 *
 * Also collapses the whitespace removal leaves behind, so a message written as
 * `"…tap here:\n\n<url>"` does not render with a trailing blank line where the
 * link used to be.
 */
export function stripLink(body: string): string {
  return body
    .replace(ASYNC_LINK, '')
    .replace(TELEHEALTH_LINK, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every consult id referenced by a set of message bodies, by kind. */
export function linkIdsIn(bodies: string[]): {async: string[]; telehealth: string[]} {
  const asyncIds = new Set<string>();
  const teleIds = new Set<string>();
  for (const body of bodies) {
    for (const m of body.matchAll(ASYNC_LINK_GLOBAL)) asyncIds.add(m[1]);
    for (const m of body.matchAll(TELEHEALTH_LINK_GLOBAL)) teleIds.add(m[1]);
  }
  return {async: [...asyncIds], telehealth: [...teleIds]};
}

/** The action an async consult's CURRENT state offers. */
export function asyncActionFor(consult: AsyncConsultResource): LinkAction {
  if (consult.status === 'invited') return 'consent';
  if (consult.status !== 'closed') return 'open';
  if (consult.rating) return 'rated';
  return consult.rateable ? 'rate' : 'ended';
}

/**
 * The action a telehealth consult's CURRENT state offers.
 *
 * `joinableUntil` is checked before the status, not after: an invite whose
 * window has closed is still `invited` on the record, so a status-only reading
 * offers a Join button forever and the patient discovers it is dead by pressing
 * it. `nowMs` is injectable so a client can run a countdown and re-render the
 * card the moment it lapses, rather than waiting for the next poll.
 */
export function telehealthActionFor(consult: TelehealthConsultResource, nowMs: number = Date.now()): LinkAction {
  const joinable = ['invited', 'waiting', 'ringing', 'in_progress'].includes(consult.status);
  if (joinable) {
    const until = consult.joinableUntil ? Date.parse(consult.joinableUntil) : NaN;
    // No window (partner-originated) never expires; an unparseable one fails
    // OPEN, matching the server's own rule.
    if (!Number.isFinite(until) || nowMs < until) return 'join';
    return 'ended';
  }
  if (consult.rating) return 'rated';
  // completed / cancelled / no_show with no rating yet — a finished call is
  // worth asking about even when it was short.
  return 'rate';
}

/**
 * Resolve what every link in a transcript can currently be used for.
 *
 * Reads each referenced consult once. An id that cannot be read (another
 * tenant's, or one that went away) is simply absent from the result — which
 * {@link actionFor} renders as `none` rather than guessing.
 */
export async function resolveLinkActions(
  client: NatzarClient,
  messages: Pick<MessageResource, 'body'>[],
  nowMs: number = Date.now(),
): Promise<LinkActions> {
  const ids = linkIdsIn(messages.map((m) => m.body ?? ''));
  const out: LinkActions = {};
  const skipMissing = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      // 404 is the documented answer for "not yours / not there"; anything
      // else is worth propagating rather than silently rendering a dead button.
      if (!isNatzarApiError(e) || e.code !== 'not_found') throw e;
    }
  };
  await Promise.all([
    ...ids.async.map((id) =>
      skipMissing(async () => {
        const {consult} = await client.asyncConsults.get(id);
        out[id] = {kind: 'async', action: asyncActionFor(consult)};
      }),
    ),
    ...ids.telehealth.map((id) =>
      skipMissing(async () => {
        const {consult} = await client.telehealth.get(id);
        out[id] = {kind: 'telehealth', action: telehealthActionFor(consult, nowMs)};
      }),
    ),
  ]);
  return out;
}

/**
 * Which action to offer for a detected link.
 *
 * The fallback when the id was not resolved is deliberately asymmetric: a
 * telehealth link defaults to `join`, which is safe because joining re-checks
 * everything server-side anyway, while an async link defaults to `none` —
 * offering to consent to something whose state we cannot see is the one
 * genuinely wrong answer.
 */
export function actionFor(link: DetectedLink, actions: LinkActions | undefined): LinkAction {
  const resolved = actions?.[link.consultId];
  if (resolved) return resolved.action;
  return link.kind === 'telehealth' ? 'join' : 'none';
}
