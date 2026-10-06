/**
 * Reading a plan back out of an older thread. The agent no longer has
 * `SubmitPlan`, but threads written before it lost the tool still carry its
 * calls, and the call is the plan's only record now.
 */
import type { ToolCallProcessRecord } from './types';
import type { ToolCallData, ToolCallResultData } from './activityTypes';

/** What became of a submitted plan. `unreviewed` is a plan whose review was
 *  never answered, which nothing can answer now. */
export type PastPlanOutcome = 'approved' | 'rejected' | 'unreviewed';

/** `submit_plan` is the same tool in threads from before the PascalCase rename. */
const PLAN_TOOL_NAMES = new Set(['SubmitPlan', 'submit_plan']);

/** The only reply the plan tool itself ever gave, and it ran only once the
 *  plan was approved. */
const PLAN_APPROVED_REPLY = 'Plan approved.';
/** What a later message leaves on a call whose review was never answered. */
const CALL_CANCELLED = /^Tool call \S+ with id \S+ was cancelled\b/;

export function isPlanTool(name: unknown): boolean {
  return typeof name === 'string' && PLAN_TOOL_NAMES.has(name);
}

/** A plan's result is one of three things: the approval reply, the review's
 *  rejection (the reviewer's feedback or a stock line), or the cancellation
 *  above. Rejection is read as what remains rather than from the error
 *  status alone, because results recorded before tool status was streamed
 *  carry none, and there a rejection looks like any other reply. */
function pastPlanOutcome(proc: ToolCallProcessRecord): PastPlanOutcome {
  const result = proc.toolCallResult as ToolCallResultData | null | undefined;
  if (!result) return 'unreviewed';
  if (proc.isFailed) return 'rejected';
  const content = typeof result.content === 'string' ? result.content.trim() : '';
  if (content.startsWith(PLAN_APPROVED_REPLY)) return 'approved';
  if (!content || CALL_CANCELLED.test(content)) return 'unreviewed';
  return 'rejected';
}

/** Null when the call carries no plan text, which leaves nothing to show. */
export function readPastPlan(
  proc: ToolCallProcessRecord,
): { description: string; outcome: PastPlanOutcome } | null {
  const description = (proc.toolCall as ToolCallData | undefined)?.args?.description;
  if (typeof description !== 'string' || !description.trim()) return null;
  return { description, outcome: pastPlanOutcome(proc) };
}
