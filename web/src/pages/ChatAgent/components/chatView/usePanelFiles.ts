import { useState } from 'react';
import { useWorkspaceFiles } from '../../hooks/useWorkspaceFiles';

/**
 * Which workspace's files the chat's file panel shows, and what it may do
 * with them. PTC shows its own. Flash has none, so it shows the workspace a
 * link last named (`override`). Home shows its own unless a link named a
 * sibling's, which it shows read-only: the Chief of Staff works only in Home.
 *
 * `refreshOwn` is for after the agent writes, and lists the view's own files
 * even while a sibling's are on screen: the turn wrote Home's, and listing the
 * sibling's would start its computer.
 */
export function usePanelFiles({ isHome, isFlashMode, workspaceId, includeSystem }: {
  isHome: boolean;
  isFlashMode: boolean;
  workspaceId: string;
  includeSystem: boolean;
}) {
  const [override, setOverride] = useState<string | null>(null);
  const shownId = isHome ? override ?? workspaceId : isFlashMode ? override : workspaceId;
  const showsSibling = isHome && !!override && override !== workspaceId;
  const shown = useWorkspaceFiles(shownId, { includeSystem });
  // An @-mention is a bare path the Chief of Staff reads in Home, so the
  // composer offers Home's files even while the panel shows a sibling's.
  const own = useWorkspaceFiles(showsSibling ? workspaceId : null, { includeSystem });

  return {
    override,
    setOverride,
    /** The workspace the panel lists, null for Flash before a link names one. */
    shownWorkspaceId: shownId,
    files: shown.files,
    loading: shown.loading,
    error: shown.error,
    refresh: shown.refresh,
    mentionFiles: showsSibling ? own.files : shown.files,
    refreshOwn: showsSibling ? own.refresh : shown.refresh,
    /** FilePanel's access props, spread onto every mount. */
    panelAccess: showsSibling
      ? { readOnly: true, singleFileMode: true, canShare: false, isHome: false, onReturnHome: () => setOverride(null) }
      : { readOnly: isFlashMode, singleFileMode: isFlashMode && !!override, canShare: !isFlashMode, isHome, onReturnHome: null },
  };
}
