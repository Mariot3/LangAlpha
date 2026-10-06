/**
 * Message classification shared by the transcript renderer and the turn-index
 * math. Steering bubbles are mid-turn injections with NO backend turn boundary
 * of their own, so every consumer must classify them identically — the edit
 * gate, the regenerate tail, and the turn projection each carried their own
 * inline `role === 'assistant' && !isSteering` check before this module.
 */

/** The subset of message fields the predicates read. Structural so both the
 *  loose `MessageRecord` wire shape and the typed `ChatMessage` union fit. */
export interface MessageLike {
  role?: unknown;
  steering?: unknown;
  steeringDelivered?: unknown;
  isSteering?: unknown;
}

/**
 * A user bubble that was injected into a RUNNING turn (queued or already
 * delivered as steering). It has no `/turns` checkpoint of its own, so an edit
 * fork would land on the NEXT turn and leave the original steering text in the
 * agent's context — the pencil is hidden for these and the hook refuses them.
 */
export function isSteeringUserMessage(message: MessageLike): boolean {
  if (message.role !== 'user') return false;
  return !!message.steeringDelivered || !!message.steering;
}

/**
 * An assistant bubble that CONTINUES the turn its predecessor opened (the
 * agent resumed after consuming steering). It is not a turn of its own: the
 * turn index folds back to the bubble it continues, and regenerate re-runs the
 * whole turn from the opener's checkpoint.
 */
export function isSteeringContinuation(message: MessageLike): boolean {
  return message.role === 'assistant' && !!message.isSteering;
}
