import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideProps } from 'lucide-react';
import { FlashGlyph } from '@/hooks/useFlashWorkspace';

/* eslint-disable react-refresh/only-export-components -- the intro's context
   with the hook and glyph that read it */

/** Whether the intro speaks for the all-workspaces agent, where Flash is the
    Chief of Staff and PTC is each workspace's Analyst. A context because the
    scenes are an id-keyed record that takes no props, and not the flag itself
    because the preview harness renders them without the features query. */
export const IntroAgentsContext = createContext(false);

/** Flash and PTC are product names and stay as written. */
const MODE_NAMES = {
  home: 'Flash',
  homeRun: 'flash',
  handoff: 'dispatched to PTC',
  taskHandoff: 'task dispatched to PTC',
  worker: 'PTC',
  footer: 'one agent · two modes',
};

/** The two agents' names in the scenes. The roles that replace Flash and PTC
    are translated like the intro copy beside the scene. */
export function useAgentNames(): typeof MODE_NAMES {
  const { t } = useTranslation();
  if (!useContext(IntroAgentsContext)) return MODE_NAMES;
  return {
    home: t('agents.chiefOfStaff'),
    homeRun: t('agents.intro.chiefOfStaffRun'),
    handoff: t('agents.intro.handoff'),
    taskHandoff: t('agents.intro.taskHandoff'),
    worker: t('agents.analyst'),
    footer: t('agents.intro.footer'),
  };
}

/** The flash row's glyph in a scene (FlashGlyph), by the intro's context. */
export function IntroHomeIcon(props: LucideProps) {
  return <FlashGlyph allWorkspaces={useContext(IntroAgentsContext)} {...props} />;
}
