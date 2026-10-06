import { useAllWorkspacesAgent } from '@/hooks/useAllWorkspacesAgent';
import { useOnboarding } from './OnboardingProvider';
import { PageIntroModal } from './engine/PageIntroModal';
import { WhatsNewModal } from './engine/WhatsNewModal';
import { GettingStartedCard } from './engine/GettingStartedCard';

/**
 * Renders the active onboarding surfaces: the contextual page intro or the
 * versioned What's-New modal (one popup at a time), plus the persistent
 * getting-started checklist card. Mounted once inside the authenticated shell.
 */
export function OnboardingHost() {
  const { phase, activeIntro, unseen, dismissPageIntro, acknowledgeWhatsNew } = useOnboarding();
  // A prop rather than read inside, because the preview harness renders the
  // modal without the features query.
  const allWorkspaces = useAllWorkspacesAgent();

  return (
    <>
      {phase === 'pageIntro' && activeIntro && (
        // Keyed so step state never leaks between two different intros.
        <PageIntroModal
          key={activeIntro.id}
          intro={activeIntro}
          onClose={dismissPageIntro}
          allWorkspaces={allWorkspaces}
        />
      )}
      {phase === 'whatsNew' && (
        <WhatsNewModal announcements={unseen} onAcknowledge={acknowledgeWhatsNew} />
      )}
      <GettingStartedCard />
    </>
  );
}
