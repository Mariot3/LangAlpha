/**
 * Under the all-workspaces agent the composer has no Flash/PTC choice: the
 * host passes a scope (All workspaces or a workspace), every conversation runs
 * on the Default model, and the second model slot (now the Background model)
 * is never shown. These pin that normalization and the scope picker that
 * replaces the mode toggle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChatInput, { type ChatInputProps } from '../chat-input';
import { ChatInputRegistry, ContextBus } from '@/lib/contextBus';
import { queryKeys } from '@/lib/queryKeys';
import { getSkills } from '@/pages/ChatAgent/utils/api';

vi.mock('@/pages/ChatAgent/utils/api', () => ({
  getSkills: vi.fn().mockResolvedValue([]),
  getModelMetadata: vi.fn().mockResolvedValue({}),
  getFlashWorkspace: vi.fn().mockResolvedValue({ workspace_id: 'home-1', name: 'Flash', status: 'flash' }),
}));

const mocks = vi.hoisted(() => ({
  allWorkspaces: true,
  preferences: null as unknown,
  mutateAsync: vi.fn(),
}));

vi.mock('@/hooks/useAllWorkspacesAgent', () => ({
  useAllWorkspacesAgent: () => mocks.allWorkspaces,
}));

vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: mocks.preferences, isLoading: false, isLoaded: true }),
}));

vi.mock('@/hooks/useAllModels', () => ({
  useAllModels: () => ({
    models: {},
    validModelNames: new Set(),
    metadata: {},
    isLoading: false,
    systemDefaults: { default_model: 'model-default', flash_model: 'model-flash-default' },
  }),
}));

vi.mock('@/hooks/useUpdatePreferences', () => ({
  useUpdatePreferences: () => ({ mutateAsync: mocks.mutateAsync, mutate: vi.fn() }),
}));

vi.mock('../use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(() => ({ id: 't', dismiss: vi.fn(), update: vi.fn() })),
}));

vi.mock('../chat-input.modelMenu', () => ({
  ChatInputModelMenu: ({ onSelectModel, selectedModel }: {
    onSelectModel: (m: string) => void;
    selectedModel: string | null;
  }) => (
    <>
      <span>{`pill:${selectedModel}`}</span>
      <button type="button" onClick={() => onSelectModel('model-beta')}>pick-beta</button>
    </>
  ),
  ModelTriggerMeasure: () => null,
}));

let queryClient: QueryClient;

// The toolbar also paints every item into an aria-hidden measure row, so the
// visible controls are found by role, which skips it.
const pill = (name: string) => screen.getByRole('button', { name });
const pickerRow = (name: string) => {
  const menu = document.querySelector<HTMLElement>('.workspace-dropdown');
  if (!menu) throw new Error('scope picker is closed');
  return within(menu).getByText(name);
};

function renderInput(props: Partial<ChatInputProps> = {}) {
  queryClient.setQueryData(queryKeys.user.preferences(), mocks.preferences);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChatInput
          onSend={vi.fn()}
          scope="all"
          onScopeChange={vi.fn()}
          workspaces={[
            { workspace_id: 'ws-1', name: 'Alpha desk' },
            { workspace_id: 'ws-2', name: 'Beta desk' },
          ] as ChatInputProps['workspaces']}
          selectedWorkspaceId="ws-1"
          onWorkspaceChange={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ChatInput with the all-workspaces agent', () => {
  beforeEach(() => {
    ContextBus.__resetForTests();
    ChatInputRegistry.__resetForTests();
    Element.prototype.scrollIntoView = vi.fn();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.allWorkspaces = true;
    mocks.preferences = {
      model_preference: { preferred_model: 'model-alpha', preferred_flash_model: 'model-bg' },
    };
    mocks.mutateAsync.mockReset().mockResolvedValue(undefined);
    vi.mocked(getSkills).mockClear();
  });
  afterEach(() => {
    ContextBus.__resetForTests();
    ChatInputRegistry.__resetForTests();
  });

  it('starts on the Default model on All workspaces, never the background slot', () => {
    renderInput();
    expect(screen.getByText('pill:model-alpha')).toBeInTheDocument();

    // A pick rides the next send; it no longer saves a preference.
    fireEvent.click(screen.getByText('pick-beta'));
    expect(screen.getByText('pill:model-beta')).toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('keeps the Flash model slot with the flag off', () => {
    mocks.allWorkspaces = false;
    renderInput({ scope: undefined, onScopeChange: undefined, mode: 'fast', onModeChange: vi.fn() });
    expect(screen.getByText('pill:model-bg')).toBeInTheDocument();
    expect(pill('Flash')).toBeInTheDocument();
  });

  it('replaces the mode toggle with a scope picker that keeps plan mode', () => {
    renderInput();
    expect(screen.queryByText('Flash')).not.toBeInTheDocument();
    expect(screen.queryByText('PTC')).not.toBeInTheDocument();
    expect(pill('All workspaces')).toBeInTheDocument();
    expect(pill('Plan')).toBeInTheDocument();
  });

  it('picks a workspace before switching the scope to it', () => {
    const calls: string[] = [];
    renderInput({
      onScopeChange: (scope) => calls.push(`scope:${scope}`),
      onWorkspaceChange: (id) => calls.push(`ws:${id}`),
    });
    fireEvent.click(pill('All workspaces'));
    fireEvent.mouseDown(pickerRow('Beta desk'));
    expect(calls).toEqual(['ws:ws-2', 'scope:workspace']);
  });

  it('switches back to All workspaces from a workspace, keeping plan mode', () => {
    const onScopeChange = vi.fn();
    renderInput({ scope: 'workspace', onScopeChange });
    expect(pill('Plan')).toBeInTheDocument();
    fireEvent.click(pill('Alpha desk'));
    fireEvent.mouseDown(pickerRow('All workspaces'));
    expect(onScopeChange).toHaveBeenCalledWith('all');
  });

  it('offers All workspaces to a user with no workspace yet', () => {
    renderInput({ workspaces: [], selectedWorkspaceId: null, emptyWorkspacesHint: 'Make one first' });
    fireEvent.click(pill('All workspaces'));
    expect(pickerRow('Make one first')).toBeInTheDocument();
  });

  it("lists Home's skills on All workspaces, where the turn runs", async () => {
    renderInput();
    await waitFor(() => {
      expect(getSkills).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'home-1' }));
    });
  });
});
