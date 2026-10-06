import type { ComposerScope } from '@/components/ui/chat-input.types';

type MarketMode = 'fast' | 'ptc';

/**
 * The composer props for MarketView's mode. Under the all-workspaces agent
 * 'fast' still names the flash row in the URL and the stored preference, and
 * the flash row is All workspaces there, so the composer receives it as a
 * scope instead of a Flash/PTC choice.
 */
export function composerModeProps(
  allWorkspaces: boolean,
  mode: MarketMode,
  onModeChange: (mode: MarketMode) => void,
): { scope: ComposerScope; onScopeChange: (scope: ComposerScope) => void } | { mode: MarketMode; onModeChange: (mode: MarketMode) => void } {
  if (!allWorkspaces) return { mode, onModeChange };
  return {
    scope: mode === 'fast' ? 'all' : 'workspace',
    onScopeChange: (scope) => onModeChange(scope === 'all' ? 'fast' : 'ptc'),
  };
}
