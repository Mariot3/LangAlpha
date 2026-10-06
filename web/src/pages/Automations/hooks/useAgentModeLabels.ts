import { useTranslation } from 'react-i18next';
import { useAllWorkspacesAgent } from '@/hooks/useAllWorkspacesAgent';
import { useFlashWorkspace } from '@/hooks/useFlashWorkspace';

type AgentMode = string | null | undefined;

export interface AgentModeLabels {
  /** Where an automation runs, in one phrase that names its workspace when given. */
  label: (mode: AgentMode, workspaceName?: string) => string;
  /** The same, as the parts of a kicker that joins them with dots. */
  kicker: (mode: AgentMode, workspaceName?: string) => string[];
  /** The agent picker's two choices. */
  options: { flash: string; ptc: string };
}

/**
 * Where an automation runs, as the reader sees it. The stored modes stay
 * `flash` and `ptc`; without the flag they read as those two agents, and
 * under the all-workspaces agent as a place: All workspaces, where the Chief
 * of Staff runs, or one workspace and its Analyst.
 */
export function useAgentModeLabels(): AgentModeLabels {
  const { t } = useTranslation();
  const allWorkspaces = useAllWorkspacesAgent();
  if (allWorkspaces) {
    const label = (mode: AgentMode, workspaceName?: string) => {
      if (mode !== 'ptc') return t('agents.allWorkspaces');
      return workspaceName ? t('agents.inWorkspace', { workspace: workspaceName }) : t('automation.detailWorkspace');
    };
    return {
      label,
      // The workspace is the place, so its name goes inside the label.
      kicker: (mode, workspaceName) => [label(mode, workspaceName)],
      options: { flash: t('agents.allWorkspaces'), ptc: t('automation.detailWorkspace') },
    };
  }
  const label = (mode: AgentMode, workspaceName?: string) => {
    if (mode !== 'ptc') return t('automation.flash');
    return workspaceName ? t('automation.ptcInWorkspace', { workspace: workspaceName }) : t('automation.ptc');
  };
  return {
    label,
    kicker: (mode, workspaceName) => (workspaceName ? [label(mode), workspaceName] : [label(mode)]),
    options: { flash: t('automation.flash'), ptc: t('automation.ptcSandbox') },
  };
}

/**
 * The mode an automation runs in, for showing and editing it. The Chief of
 * Staff files its automations as `ptc` in Home, which runs where `flash`
 * does, so they read as All workspaces (Flash without the flag) rather than
 * a workspace the lists leave out.
 */
export function useRunsAs() {
  const homeId = useFlashWorkspace()?.id;
  return <M extends AgentMode>(mode: M, workspaceId?: string | null): M | 'flash' =>
    mode === 'ptc' && !!workspaceId && workspaceId === homeId ? 'flash' : mode;
}
