/**
 * A tool call keeps the streaming indicator going.
 *
 * Only text the reader sees arriving proves a turn is alive, reply text or an
 * open thought, so the indicator steps aside for that alone. It used to hide
 * while a tool call was being written and while one ran, on the grounds that
 * the tool's row said "busy", but a row that sits still for a minute-long call
 * reads as stuck.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MessageBubble } from '../MessageBubble';
import { MessageActionsProvider } from '../MessageActionsContext';
import { TranscriptDisplayContext } from '@/lib/transcriptDisplay';
import { handleToolCallChunks } from '../../../session/stream/mainEventHandlers';
import type { MessageRecord, SetMessages } from '../../../hooks/utils/types';

vi.mock('@/hooks/useUser', () => ({ useUser: () => ({ user: null }) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('../../Markdown', () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>,
}));

function bubble(message: MessageRecord) {
  return (
    <TranscriptDisplayContext.Provider value={{ turnDisplay: 'lean', streamingMode: 'token' }}>
      <MessageActionsProvider actions={{}}>
        <MessageBubble message={message} turnIndex={0} isTurnTail isTurnLive />
      </MessageActionsProvider>
    </TranscriptDisplayContext.Provider>
  );
}

const quiet = (c: HTMLElement) =>
  c.querySelector('[data-testid="streaming-indicator"]')?.getAttribute('data-quiet');

const base: MessageRecord = {
  id: 'a1', role: 'assistant', contentType: 'text', timestamp: new Date(), isStreaming: true,
  content: '', contentSegments: [], reasoningProcesses: {}, toolCallProcesses: {}, arrivalSeq: 0,
};

describe('streaming indicator through a tool call', () => {
  it('stays visible while the model writes a tool call', () => {
    // Through the stream's own handler, so an arrival it stamps would show.
    let message = base;
    const setMessages: SetMessages = (update) => { [message] = update([message]); };
    const view = render(bubble(message));
    handleToolCallChunks({
      assistantMessageId: 'a1',
      chunks: [{ index: 0, name: 'WebSearch', args: '{"query": "AAPL' }, { index: 0, args: ' price"}' }],
      setMessages,
    });
    view.rerender(bubble(message));

    expect(message.pendingToolCallChunks).not.toEqual({});
    expect(quiet(view.container)).toBe('true');
  });

  it('stays visible while a tool whose row is on screen runs', () => {
    const view = render(bubble(base));
    view.rerender(bubble({
      ...base,
      contentSegments: [{ type: 'tool_call', order: 0, toolCallId: 'tc1' }],
      toolCallProcesses: {
        tc1: {
          toolName: 'WebSearch', toolCall: { args: { query: 'AAPL price' } },
          isInProgress: true, isComplete: false, isFailed: false, order: 0, _createdAt: Date.now(),
        },
      },
    }));

    expect(quiet(view.container)).toBe('true');
  });
});
