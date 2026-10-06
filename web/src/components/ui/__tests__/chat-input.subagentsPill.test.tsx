/**
 * The Subagents toggle: an icon with no label, shown in PTC. Pressed and drawn
 * connected while subagents are on, it flips through a thread host, or holds
 * the pick itself without one. It folds into the ⋯ menu like any toggle, with
 * a check while on and no ⋯ dot, since on is the default and a dot lit for it
 * would never mean anything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChatInput, { type ChatInputProps } from '../chat-input';
import { useToolbarItems } from '../chat-input.toolbar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../dropdown-menu';
import { ChatInputRegistry, ContextBus } from '@/lib/contextBus';

vi.mock('@/pages/ChatAgent/utils/api', () => ({
  getSkills: vi.fn().mockResolvedValue([]),
  getModelMetadata: vi.fn().mockResolvedValue({}),
}));

const prefs = vi.hoisted(() => ({ isLoaded: true }));

// Read and holding no row, so the default is on, unless a test unreads it.
vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: null, isLoading: !prefs.isLoaded, isLoaded: prefs.isLoaded }),
}));

vi.mock('../use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

function renderInput(props: Partial<ChatInputProps>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChatInput onSend={vi.fn()} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pill = () => screen.queryByRole('button', { name: /^Subagents$/ });

describe('ChatInput: the Subagents pill', () => {
  beforeEach(() => {
    prefs.isLoaded = true;
    ContextBus.__resetForTests();
    ChatInputRegistry.__resetForTests();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    ContextBus.__resetForTests();
    ChatInputRegistry.__resetForTests();
  });

  it('shows pressed in PTC while subagents are on, and flips through the host', () => {
    const onToggle = vi.fn();
    const { rerender } = renderInput({ mode: 'ptc', subagentsAllowed: true, onToggleSubagents: onToggle });
    expect(pill()).toHaveAttribute('aria-pressed', 'true');
    expect(pill()).not.toHaveTextContent('Subagents');
    expect(pill()!.querySelector('.subagents-glyph')).toHaveAttribute('data-on', 'true');

    fireEvent.click(pill()!);
    expect(onToggle).toHaveBeenCalledWith(false);

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ChatInput onSend={vi.fn()} mode="ptc" subagentsAllowed={false} onToggleSubagents={onToggle} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(pill()).toHaveAttribute('aria-pressed', 'false');
    expect(pill()!.querySelector('.subagents-glyph')).toHaveAttribute('data-on', 'false');
    fireEvent.click(pill()!);
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });

  it("is hidden while its thread host has not read the thread's value", () => {
    renderInput({ mode: 'ptc', subagentsAllowed: null, onToggleSubagents: vi.fn() });
    expect(pill()).toBeNull();
  });

  it('stays interactive while a turn streams', () => {
    const onToggle = vi.fn();
    renderInput({ mode: 'ptc', isLoading: true, subagentsAllowed: true, onToggleSubagents: onToggle });
    fireEvent.click(pill()!);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('is hidden on a flash thread, which names its mode without a toggle', () => {
    renderInput({ mode: 'fast', subagentsAllowed: true, onToggleSubagents: vi.fn() });
    expect(pill()).toBeNull();
  });

  it('is hidden when a mode toggle has flash picked', () => {
    renderInput({ mode: 'fast', onModeChange: vi.fn(), subagentsAllowed: true, onToggleSubagents: vi.fn() });
    expect(pill()).toBeNull();
  });

  it('holds its own pick without a host, and a PTC send carries only that pick', () => {
    const onSend = vi.fn();
    renderInput({ mode: 'ptc', onModeChange: vi.fn(), onSend });
    const sendText = (text: string) => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    };
    expect(pill()).toHaveAttribute('aria-pressed', 'true');
    sendText('left alone');
    expect(onSend.mock.calls[0][3].subagentsAllowed).toBeUndefined();

    fireEvent.click(pill()!);
    expect(pill()).toHaveAttribute('aria-pressed', 'false');
    sendText('flipped');
    expect(onSend.mock.calls[1][3]).toMatchObject({ subagentsAllowed: false });
  });

  it('names what it shows while the default is unread, which a stored default may contradict', () => {
    prefs.isLoaded = false;
    const onSend = vi.fn();
    renderInput({ mode: 'ptc', onModeChange: vi.fn(), onSend });
    expect(pill()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unread' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend.mock.calls[0][3]).toMatchObject({ subagentsAllowed: true });
  });
});

describe('the Subagents toolbar item', () => {
  const base = {
    mode: 'ptc' as const,
    watchMode: false,
    setWatchMode: vi.fn(),
    marketWatchEnabled: true,
  };

  it('sits between the mode pill and Watch, and raises no ⋯ dot', () => {
    const { result } = renderHook(() => useToolbarItems({
      ...base, onModeChange: vi.fn(), subagentsAllowed: true, onToggleSubagents: vi.fn(),
    }));
    expect(result.current.map((i) => i.id)).toEqual(['scope', 'mode', 'subagents', 'watch', 'workspace']);
    const item = result.current.find((i) => i.id === 'subagents')!;
    expect(item).toMatchObject({ group: 'toggle', visible: true });
    expect(item.active).toBeFalsy();
  });

  it('folds into the menu with a check while on, and flips from there', () => {
    const onToggle = vi.fn();
    const { result, rerender } = renderHook(
      ({ allowed }: { allowed: boolean }) => useToolbarItems({ ...base, subagentsAllowed: allowed, onToggleSubagents: onToggle }),
      { initialProps: { allowed: true } },
    );
    const menuOf = () => render(
      <DropdownMenu open>
        <DropdownMenuTrigger>more</DropdownMenuTrigger>
        <DropdownMenuContent>{result.current.find((i) => i.id === 'subagents')!.menu()}</DropdownMenuContent>
      </DropdownMenu>,
    );

    const on = menuOf();
    const onItem = screen.getByRole('menuitem', { name: /Subagents/ });
    expect(onItem.querySelector('.lucide-check')).not.toBeNull();
    fireEvent.click(onItem);
    expect(onToggle).toHaveBeenCalledWith(false);
    on.unmount();

    rerender({ allowed: false });
    menuOf();
    const offItem = screen.getByRole('menuitem', { name: /Subagents/ });
    expect(offItem.querySelector('.lucide-check')).toBeNull();
    fireEvent.click(offItem);
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });
});
