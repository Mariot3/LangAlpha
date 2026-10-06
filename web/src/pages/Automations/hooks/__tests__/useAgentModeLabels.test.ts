import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderHookWithProviders } from '@/test/utils';

const flag = vi.hoisted(() => ({ on: false }));
vi.mock('@/hooks/useAllWorkspacesAgent', () => ({ useAllWorkspacesAgent: () => flag.on }));
vi.mock('@/hooks/useFlashWorkspace', () => ({ useFlashWorkspace: () => ({ id: 'home-1', name: 'Home' }) }));

import { useAgentModeLabels, useRunsAs } from '../useAgentModeLabels';

afterEach(() => {
  flag.on = false;
});

describe('useAgentModeLabels', () => {
  it('reads the stored modes as places under the all-workspaces agent', () => {
    flag.on = true;
    const { label, kicker, options } = renderHookWithProviders(() => useAgentModeLabels()).result.current;
    expect(label('flash')).toBe('All workspaces');
    expect(label('ptc', 'NVDA deep dive')).toBe('In NVDA deep dive');
    expect(label('ptc')).toBe('Workspace');
    expect(kicker('ptc', 'NVDA deep dive')).toEqual(['In NVDA deep dive']);
    expect(options).toEqual({ flash: 'All workspaces', ptc: 'Workspace' });
  });

  it('keeps the mode names without it', () => {
    const { label, kicker, options } = renderHookWithProviders(() => useAgentModeLabels()).result.current;
    expect(label('flash')).toBe('Flash');
    expect(label('ptc', 'NVDA deep dive')).toBe('PTC in NVDA deep dive');
    expect(label('ptc')).toBe('PTC');
    expect(kicker('ptc', 'NVDA deep dive')).toEqual(['PTC', 'NVDA deep dive']);
    expect(kicker('flash')).toEqual(['Flash']);
    expect(options.flash).toBe('Flash');
  });
});

describe('useRunsAs', () => {
  it('reads a Chief of Staff automation, filed as ptc in Home, as All workspaces', () => {
    const runsAs = renderHookWithProviders(() => useRunsAs()).result.current;
    expect(runsAs('ptc', 'home-1')).toBe('flash');
    expect(runsAs('ptc', 'ws-nvda')).toBe('ptc');
    expect(runsAs('flash', 'home-1')).toBe('flash');
    expect(runsAs('ptc', null)).toBe('ptc');
  });
});
