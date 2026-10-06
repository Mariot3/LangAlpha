/**
 * Markdown rebuilds every rendered block when the folders it reads change
 * identity, so the hook keeps one value until a folder actually changes,
 * whatever else a refetched workspace row carries.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useComputerFolders } from '../useComputerFolders';

const mocks = vi.hoisted(() => ({
  viewed: null as Record<string, unknown> | null,
  rows: [] as Record<string, unknown>[],
}));

vi.mock('@/hooks/useWorkspace', () => ({
  useWorkspace: () => ({ data: mocks.viewed }),
}));

vi.mock('@/hooks/useAllWorkspaces', () => ({
  useAllWorkspaces: () => ({ data: { workspaces: mocks.rows } }),
}));

const viewed = (extra: Record<string, unknown> = {}) => ({
  workspace_id: 'ws-1', computer_id: 'c-1', dir_name: 'NVDA', previous_dir_names: [], status: 'running', ...extra,
});
const sibling = (extra: Record<string, unknown> = {}) => ({
  workspace_id: 'ws-2', computer_id: 'c-1', dir_name: 'AMD', previous_dir_names: [], status: 'running', ...extra,
});

describe('useComputerFolders', () => {
  it('keeps its value across a refetch that changed no folder', () => {
    mocks.viewed = viewed({ last_activity_at: '2026-10-05T10:00:00Z' });
    mocks.rows = [mocks.viewed, sibling()];
    const { result, rerender } = renderHook(() => useComputerFolders('ws-1'));
    const first = result.current;
    expect(first?.siblings.map((s) => s.dirName)).toEqual(['AMD']);

    mocks.viewed = viewed({ last_activity_at: '2026-10-05T10:05:00Z' });
    mocks.rows = [mocks.viewed, sibling({ status: 'stopped' })];
    rerender();
    expect(result.current).toBe(first);
  });

  it('changes when a folder does', () => {
    mocks.viewed = viewed();
    mocks.rows = [mocks.viewed, sibling()];
    const { result, rerender } = renderHook(() => useComputerFolders('ws-1'));
    const first = result.current;

    mocks.rows = [mocks.viewed, sibling({ dir_name: 'AMD-2', previous_dir_names: ['AMD'] })];
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current?.siblings[0]).toMatchObject({ dirName: 'AMD-2', previousDirNames: ['AMD'] });
  });
});
