import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeatureEnabled } from './useFeatures';

export const ALL_WORKSPACES_AGENT = 'all_workspaces_agent';

/**
 * Whether this user's chats outside a workspace run as the Chief of Staff in
 * Home rather than on Flash.
 *
 * The server decides where a turn runs, so this only picks which product the
 * UI shows. It fails closed like every flag: until the features load, the user
 * sees Flash, which the server would also run with the flag off.
 */
export function useAllWorkspacesAgent(): boolean {
  return useFeatureEnabled(ALL_WORKSPACES_AGENT);
}

interface LabelledWorkspace {
  status?: string | null;
  name?: string | null;
  description?: string | null;
}

export interface WorkspaceText {
  name: string;
  description: string;
  /** The short kind a tile shows beside the date. */
  tag: string;
}

/**
 * A workspace's display text. The per-user flash row is the Chief of Staff's
 * Home once the flag is on, and keeps its stored name "Flash" and description
 * so older clients still know it; the UI calls it "All workspaces", the choice
 * it stands for, and describes that choice.
 */
export function useWorkspaceText(): (workspace: LabelledWorkspace | null | undefined) => WorkspaceText {
  const { t } = useTranslation();
  const allWorkspaces = useAllWorkspacesAgent();
  return useCallback(
    (workspace) => {
      const isFlash = workspace?.status === 'flash';
      if (allWorkspaces && isFlash) {
        return {
          name: t('agents.allWorkspaces'),
          description: t('agents.widgets.allWorkspacesDesc'),
          tag: t('agents.widgets.tagAllWorkspaces'),
        };
      }
      return {
        name: workspace?.name ?? '',
        description: workspace?.description ?? '',
        tag: isFlash ? t('dashboard.widgets.workspacePicker.tagFlash') : t('dashboard.widgets.workspacePicker.tagWorkspace'),
      };
    },
    [allWorkspaces, t],
  );
}

/** A workspace's display name, for a surface that shows only that. */
export function useWorkspaceLabel(): (workspace: LabelledWorkspace | null | undefined) => string {
  const text = useWorkspaceText();
  return useCallback((workspace) => text(workspace).name, [text]);
}
