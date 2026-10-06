/**
 * An open thought hides the streaming indicator from its first chunk on, and
 * keeps it hidden across the thought settling.
 *
 * Thought text counts as arriving only while its row is open, and the row says
 * so from an effect. Gated on the row having text, that mark landed a commit
 * after the first chunk, the bubble took the chunk as text already there when
 * the row opened, and a thought whose body arrived whole never hid it. Counted
 * only while a row was open, a settling thought stopped counting at once, and
 * the indicator blinked on in the moment between the thought and its reply.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MessageBubble } from '../MessageBubble';
import { MessageActionsProvider } from '../MessageActionsContext';
import { TranscriptDisplayContext } from '@/lib/transcriptDisplay';
import { handleReasoningContent, handleReasoningSignal } from '../../../session/stream/mainEventHandlers';
import type { StreamRefs } from '../../../session/streamRefs';
import type { MessageRecord, SetMessages } from '../../../hooks/utils/types';

vi.mock('@/hooks/useUser', () => ({ useUser: () => ({ user: null }) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('../../Markdown', () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>,
}));

// Verbose display opens a live thought's row by default.
function bubble(message: MessageRecord) {
  return (
    <TranscriptDisplayContext.Provider value={{ turnDisplay: 'verbose', streamingMode: 'token' }}>
      <MessageActionsProvider actions={{}}>
        <MessageBubble message={message} turnIndex={0} isTurnTail isTurnLive />
      </MessageActionsProvider>
    </TranscriptDisplayContext.Provider>
  );
}

const quiet = (c: HTMLElement) =>
  c.querySelector('[data-testid="streaming-indicator"]')?.getAttribute('data-quiet');

// A live thought with an empty row, and the stream state its handlers write to.
function openThought() {
  const live: { message: MessageRecord } = {
    message: {
      id: 'a1', role: 'assistant', contentType: 'text', timestamp: new Date(), isStreaming: true,
      content: '', contentSegments: [{ type: 'reasoning', reasoningId: 'r1', order: 0 }],
      reasoningProcesses: { r1: { content: '', isReasoning: true, reasoningComplete: false, order: 0 } },
      toolCallProcesses: {}, arrivalSeq: 0,
    },
  };
  const setMessages: SetMessages = (update) => { [live.message] = update([live.message]); };
  const refs = {
    currentReasoningIdRef: { current: 'r1' },
    contentOrderCounterRef: { current: 0 },
    isReconnect: false,
  } as unknown as StreamRefs;
  return { live, setMessages, refs };
}

describe('streaming indicator through an open thought', () => {
  afterEach(() => vi.useRealTimers());

  it('steps aside for the first chunk of a thought whose row is open', () => {
    const { live, setMessages, refs } = openThought();
    const view = render(bubble(live.message));
    expect(quiet(view.container)).toBe('true');

    handleReasoningContent({
      assistantMessageId: 'a1',
      content: '**Comparing inputs**\n\nChecking the supplied evidence.',
      refs,
      setMessages,
    });
    view.rerender(bubble(live.message));

    expect(view.container.querySelector('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true');
    expect(quiet(view.container)).toBe('false');
  });

  it('stays aside as the thought settles, then returns once nothing follows', () => {
    vi.useFakeTimers();
    const { live, setMessages, refs } = openThought();
    const view = render(bubble(live.message));
    handleReasoningContent({
      assistantMessageId: 'a1',
      content: '**Comparing inputs**\n\nChecking the supplied evidence.',
      refs,
      setMessages,
    });
    view.rerender(bubble(live.message));
    expect(quiet(view.container)).toBe('false');

    // The reply's first chunk follows the settle by a moment: the indicator
    // must not flash on in that gap.
    handleReasoningSignal({ assistantMessageId: 'a1', signalContent: 'complete', refs, setMessages });
    view.rerender(bubble(live.message));
    expect(quiet(view.container)).toBe('false');

    // Nothing follows: the turn is still live, so the indicator comes back.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(quiet(view.container)).toBe('true');
  });
});
