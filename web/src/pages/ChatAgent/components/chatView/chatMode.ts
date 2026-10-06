export interface ChatAgentMode {
  /** The flash row under the all-workspaces agent: the Chief of Staff's Home. */
  isHome: boolean;
  /** The agent a turn here runs as. */
  agentMode: 'flash' | 'ptc';
  isFlashMode: boolean;
  /** Flash and Home both dispatch work into other workspaces: PTC cards open
   *  the threads they started, report-backs land here, and file links reach
   *  into the workspaces that wrote them. */
  dispatches: boolean;
}

/**
 * Which agent a chat view runs, from what the navigation asked for and what
 * the workspace row says. Direct URL navigation carries no route state, so the
 * row is the only thing left that names the flash row.
 *
 * Under the all-workspaces agent the flash row is Home, where the Chief of
 * Staff runs as a full PTC agent: whatever named the flash row, its threads
 * are PTC threads and nothing in the view is Flash.
 */
export function resolveChatMode({
  allWorkspacesAgent,
  navAgentMode,
  navIsFlash,
  rowStatus,
}: {
  allWorkspacesAgent: boolean;
  navAgentMode: string | undefined;
  navIsFlash: boolean;
  rowStatus: string | null | undefined;
}): ChatAgentMode {
  const rowIsFlash = rowStatus === 'flash';
  if (allWorkspacesAgent && (rowIsFlash || navIsFlash || navAgentMode === 'flash')) {
    return { isHome: true, agentMode: 'ptc', isFlashMode: false, dispatches: true };
  }
  const flashAgent = navAgentMode ? navAgentMode === 'flash' : rowIsFlash;
  const agentMode = flashAgent ? 'flash' : 'ptc';
  const isFlashMode = agentMode === 'flash' || navIsFlash;
  return { isHome: false, agentMode, isFlashMode, dispatches: isFlashMode };
}
