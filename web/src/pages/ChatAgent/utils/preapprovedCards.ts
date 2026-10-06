/**
 * Cards for a hand-off or new workspace the user approved in advance. No
 * approval request carried the call, so no proposal holds its card: it is
 * drawn from the tool's own result, which the server marks `preapproved`
 * (`src/tools/secretary/approvals.py`).
 */

const HANDOFF_TOOLS = new Set(['delegate_to_analyst', 'ptc_agent']);

export type PreapprovedCard =
  | { type: 'ptc_agent'; proposal: Record<string, unknown> }
  | { type: 'create_workspace'; proposal: Record<string, unknown> };

interface ToolCallLike {
  toolName?: unknown;
  toolCall?: { args?: Record<string, unknown> } | null;
  toolCallResult?: { content?: unknown } | null;
}

function resultOf(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'string' || !content.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function preapprovedCard(
  toolName: unknown,
  args: Record<string, unknown> | undefined,
  content: unknown,
): PreapprovedCard | null {
  const isHandoff = HANDOFF_TOOLS.has(toolName as string);
  if (!isHandoff && toolName !== 'manage_workspaces') return null;
  const result = resultOf(content);
  if (result?.success !== true || result.preapproved !== true) return null;
  if (!isHandoff) {
    return {
      type: 'create_workspace',
      proposal: { status: 'approved', workspace_name: result.workspace_name, workspace_description: result.workspace_description },
    };
  }
  return {
    type: 'ptc_agent',
    proposal: {
      status: 'approved',
      question: typeof args?.question === 'string' ? args.question : '',
      workspace_id: result.workspace_id,
      workspace_name: result.workspace_name,
      thread_id: result.thread_id,
      report_back: result.report_back === true,
    },
  };
}

/** Whether a tool result is a hand-off, made without asking, that reports back. */
export function preapprovedReportBack(content: unknown): boolean {
  const result = resultOf(content);
  return result?.preapproved === true && result.status === 'dispatched' && result.report_back === true;
}

// By result record, which the stream replaces rather than edits: the
// transcript rebuilds on every chunk, and a card that kept its identity is one
// the rebuild can reuse instead of redrawing.
const byResult = new WeakMap<object, PreapprovedCard | null>();

/** The card a finished secretary call draws, or null when it asked first. */
export function preapprovedCardOf(proc: ToolCallLike | undefined): PreapprovedCard | null {
  const result = proc?.toolCallResult;
  if (!result) return null;
  let card = byResult.get(result);
  if (card === undefined) {
    card = preapprovedCard(proc.toolName, proc.toolCall?.args, result.content);
    byResult.set(result, card);
  }
  return card;
}
