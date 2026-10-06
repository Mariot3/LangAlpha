/**
 * One RAW projection pass over the transcript, producing the turn semantics
 * every consumer needs (edit, regenerate, feedback, the regenerate tail).
 *
 * The projection MUST run over the raw array: the positional count of assistant
 * bubbles is what maps UI position → backend `turn_index`, so hidden bubbles
 * still occupy their turn. Visibility filtering happens afterwards, and only
 * the tail scan (a render affordance) reads the filtered list.
 */
import { isSteeringContinuation } from './messagePredicates';
import { projectMessageContent } from './contentProjection';
import type { MessageRecord } from './types';

export interface ProjectedMessage {
  message: MessageRecord;
  /** Index into the RAW messages array. */
  rawIndex: number;
  /** Backend turn this bubble belongs to. */
  turnIndex: number;
}

/**
 * Assign every bubble its backend turn, with `c` = running count of
 * non-steering assistant bubbles seen so far:
 *
 *   user message              → `c`      (the turn it initiates)
 *   non-steering assistant    → `c`, then `c++`
 *   steering continuation     → `c - 1`  (folds into the turn it continues)
 *
 * This is the single rule both historical derivations agree on: the edit path
 * counted non-steering assistants BEFORE a user message (exclusive) and the
 * feedback/regenerate paths counted up to AND INCLUDING an assistant bubble
 * minus one — identical everywhere except steering continuations, where the
 * fold-back above is what the inclusive form already produced.
 */
export function projectTurns(messages: MessageRecord[]): ProjectedMessage[] {
  const projected = new Array<ProjectedMessage>(messages.length);
  let c = 0;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    let turnIndex: number;
    if (isSteeringContinuation(message)) {
      turnIndex = c - 1;
    } else if (message.role === 'assistant') {
      turnIndex = c;
      c++;
    } else {
      // User bubbles initiate turn `c`; notifications carry no turn of their
      // own and ride the turn they were inserted into.
      turnIndex = c;
    }
    projected[i] = { message, rawIndex: i, turnIndex };
  }
  return projected;
}

/**
 * An assistant bubble that settled with nothing to paint. Some turns legitimately
 * finalize empty in STATE (a HITL resume whose content landed on another bubble,
 * a history turn whose only event was a re-raised interrupt deduped by
 * interrupt_id, a turn whose only call was a hidden tool) and they must stay in
 * state because edit/regenerate map UI position → backend turn_index by counting
 * assistant bubbles. But painting them shows an orphan avatar + action row, so
 * the list skips rendering them.
 *
 * Empty is judged on the render blocks the bubble would draw, not on its raw
 * segments: the builder drops hidden tool calls (TodoWrite's list floats
 * outside the bubble) and todo-list segments, so a turn of only those has
 * segments and still paints a blank column. Beyond the blocks, the Sources
 * pill, the Stopped chip, an error, and a live stream keep the bubble.
 *
 * INVARIANT: everything an assistant bubble can render must surface through
 * its content projection / provenanceRecords / error / stopped / isStreaming.
 * A future assistant field that renders OUTSIDE those (e.g. assistant-side
 * attachments) must be added to this guard or its bubbles will be hidden.
 * `isSubagentView` only keys the projection cache the bubble itself reads.
 */
export function isOrphanAssistantMessage(message: MessageRecord, isSubagentView = false): boolean {
  if (message.role !== 'assistant') return false;
  if (message.isStreaming) return false;
  const provenance = message.provenanceRecords as Record<string, unknown> | undefined;
  if (provenance && Object.keys(provenance).length > 0) return false;
  if (message.error || message.stopped) return false;
  const projection = projectMessageContent(message, isSubagentView);
  return projection.textCount === 0 && projection.blocks.every((block) => block.type === 'text');
}

/** Drop bubbles the list must not paint (see `isOrphanAssistantMessage`). */
export function visibleProjection(projected: ProjectedMessage[], isSubagentView = false): ProjectedMessage[] {
  return projected.filter((p) => !isOrphanAssistantMessage(p.message, isSubagentView));
}

/**
 * Per-bubble "is this the LAST bubble of its backend turn", over the VISIBLE
 * list. A steered turn renders as several assistant bubbles but has one
 * regenerate target, so only the turn's last bubble offers the affordance.
 * Computed over the visible list on purpose: a steering continuation that
 * settled empty is never painted, so it must not steal regenerate from the
 * bubble the user can actually see.
 */
export function computeTurnTails(visible: ProjectedMessage[]): boolean[] {
  const tail = new Array<boolean>(visible.length).fill(false);
  let nextAssistantIsSteering = false;
  for (let i = visible.length - 1; i >= 0; i--) {
    const message = visible[i].message;
    if (message.role === 'assistant') {
      tail[i] = !nextAssistantIsSteering;
      nextAssistantIsSteering = isSteeringContinuation(message);
    }
  }
  return tail;
}
