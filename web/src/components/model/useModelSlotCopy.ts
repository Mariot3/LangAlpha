import { useTranslation } from 'react-i18next';
import { useAllWorkspacesAgent } from '@/hooks/useAllWorkspacesAgent';

export interface ModelSlotText {
  label: string;
  description: string;
  placeholder: string;
  /** The slot's row on the setup summary. */
  summary: string;
  explainerTitle: string;
  explainerBody: string;
}

export interface ModelSlotCopy {
  /** `preferred_model`, the model conversations run on. */
  default: ModelSlotText;
  /** `preferred_flash_model`, the cheaper one. */
  background: ModelSlotText;
  explainerTitle: string;
  /** Placeholder for a routing slot left blank to follow the second model. */
  defaultsToBackground: string;
  /** Placeholder for a second model left on Auto, which follows the first. */
  backgroundSameAsDefault: string;
  fallbackDesc: string;
  chooseDesc: string;
}

/**
 * How Setup and Settings name the two model slots. Without the flag they are
 * Primary and Flash, after the two agents; with it Flash is retired, and they
 * are Default and Background, after what each one runs.
 */
export function useModelSlotCopy(): ModelSlotCopy {
  const { t } = useTranslation();
  const allWorkspaces = useAllWorkspacesAgent();
  if (allWorkspaces) {
    return {
      default: {
        label: t('agents.models.defaultModel'),
        description: t('agents.models.defaultModelDesc'),
        placeholder: t('agents.models.defaultPlaceholder'),
        summary: t('agents.models.defaultModel'),
        explainerTitle: t('agents.models.defaultModel'),
        explainerBody: t('agents.models.explainerDefaultBody'),
      },
      background: {
        label: t('agents.models.backgroundModel'),
        description: t('agents.models.backgroundModelDesc'),
        placeholder: t('agents.models.backgroundPlaceholder'),
        summary: t('agents.models.backgroundModel'),
        explainerTitle: t('agents.models.backgroundModel'),
        explainerBody: t('agents.models.explainerBackgroundBody'),
      },
      explainerTitle: t('agents.models.explainerTitle'),
      defaultsToBackground: t('agents.models.defaultsToBackground'),
      backgroundSameAsDefault: t('agents.models.backgroundSameAsDefault'),
      fallbackDesc: t('agents.models.fallbackModelsDesc'),
      chooseDesc: t('agents.models.chooseYourModelsDesc'),
    };
  }
  return {
    default: {
      label: t('setup.primaryModel'),
      description: t('setup.primaryDescription'),
      placeholder: t('setup.primaryPlaceholder'),
      summary: t('setup.primaryModelLabel'),
      explainerTitle: t('setup.explainerDeepTitle'),
      explainerBody: t('setup.explainerDeepBody'),
    },
    background: {
      label: t('setup.flashModel'),
      description: t('setup.flashDescription'),
      placeholder: t('setup.flashPlaceholder'),
      summary: t('setup.flashModelLabel'),
      explainerTitle: t('setup.explainerFlashTitle'),
      explainerBody: t('setup.explainerFlashBody'),
    },
    explainerTitle: t('setup.explainerTitle'),
    defaultsToBackground: t('settings.modelTuning.defaultsToFlash'),
    backgroundSameAsDefault: t('setup.flashSameAsPrimary'),
    fallbackDesc: t('settings.fallbackModelsDesc'),
    chooseDesc: t('setup.chooseYourModelsDesc'),
  };
}
