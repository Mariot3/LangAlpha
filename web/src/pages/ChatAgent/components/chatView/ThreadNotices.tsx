import type React from 'react';
import type { ComposerMode } from '@/lib/modelPreferences';
import type { DefaultModelOffer, RetiredModel } from '../../hooks/useThreadModel';
import { RetiredModelNotice, ThreadModelBanner } from './ThreadModelBanner';
import { ThreadSubagentsBanner } from './ThreadSubagentsBanner';

/** What `useThreadModel` raises above a composer. */
interface ModelNotices {
  retired: RetiredModel | null;
  offer: DefaultModelOffer | null;
  dismissOffer: () => void;
}

/** What `useThreadSubagents` raises above a composer. */
interface SubagentsNotices {
  offer: boolean | null;
  closeOffer: () => void;
  expireOffer: () => void;
}

/* The rows a thread's composer settings raise above it: why the thread moved
   off a retired model, and the offers to make a model pick or a subagents flip
   the default. Every host renders them from here, so the chat view and the
   market panels show the same rows. */
export function ThreadNotices({
  model,
  subagents,
  mode,
}: {
  model: ModelNotices;
  subagents: SubagentsNotices;
  mode: ComposerMode;
}): React.ReactElement {
  return (
    <>
      {model.retired && <RetiredModelNotice {...model.retired} />}
      {model.offer && <ThreadModelBanner {...model.offer} mode={mode} onDismiss={model.dismissOffer} />}
      {subagents.offer !== null && (
        // Keyed by the value, so an offer for the other side starts its own clock.
        <ThreadSubagentsBanner
          key={String(subagents.offer)}
          allowed={subagents.offer}
          onDismiss={subagents.closeOffer}
          onExpire={subagents.expireOffer}
        />
      )}
    </>
  );
}
