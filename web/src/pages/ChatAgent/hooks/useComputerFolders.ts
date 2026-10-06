import { useMemo } from 'react';
import { useAllWorkspaces } from '@/hooks/useAllWorkspaces';
import { useWorkspace } from '@/hooks/useWorkspace';
import { computerFolders, type ComputerFolders } from '../utils/agentPaths';

/**
 * The workspace's own folders and the other workspaces on its computer, for
 * reading a path that names a sibling by its folder (`computerFolders`).
 *
 * Every workspace, not one page: a sibling missing from a truncated list would
 * leave its links dead without looking any different. The flash row comes
 * along, since once bound to the computer it is Home, which an analyst
 * reaches as `../Home/`.
 */
export function useComputerFolders(workspaceId: string | null | undefined): ComputerFolders | null {
  const { data: viewed } = useWorkspace(workspaceId);
  const { data: all } = useAllWorkspaces({ includeFlash: true, enabled: !!viewed?.computer_id });
  // Keyed on the folders alone: a row refetched for its activity time or
  // status is a new object, and every rendered Markdown block rebuilds when
  // this value changes identity.
  const key = JSON.stringify(computerFolders(viewed, all?.workspaces));
  return useMemo(() => JSON.parse(key) as ComputerFolders | null, [key]);
}
