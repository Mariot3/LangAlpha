/**
 * With subagents turned off on a thread, a Task or RunWorkflow call is refused
 * before anything starts and comes back as "Refused: ..." under an error
 * status. The card reads as that refusal: Failed with the reason, never
 * Running, and a spawn that never ran opens nothing, since opening it would
 * mint a tab for a subagent that does not exist.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TaskSegmentCard } from '../messageList/TaskSegmentCard';
import { WorkflowRunContext } from '../WorkflowRunContext';
import { WORKFLOW_TASK_TYPE } from '../../session/subagents/workflowRunState';
import type { SubagentTaskRecord } from '@/types/chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const REFUSED = 'Refused: the user has turned subagents off for this thread. Do the work yourself.';

function renderCard(record: Partial<SubagentTaskRecord>, onOpen = vi.fn()) {
  render(
    <WorkflowRunContext.Provider value={() => undefined}>
      <TaskSegmentCard
        subagentId="tc-1"
        onOpen={onOpen}
        task={{
          subagentId: 'tc-1',
          description: 'Pull the last four 10-Qs',
          prompt: '',
          type: 'research',
          action: 'init',
          status: 'running',
          ...record,
        }}
      />
    </WorkflowRunContext.Provider>,
  );
  return onOpen;
}

describe('a launch refused with subagents off', () => {
  it('reads as a failed spawn with its reason, and opens nothing', () => {
    renderCard({ status: 'error', launchFailed: true, result: REFUSED });

    expect(screen.getByText('chat.taskCard.statusFailed')).toBeInTheDocument();
    expect(screen.getByTestId('subagent-stop-reason')).toHaveTextContent('turned subagents off');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads as a failed follow-up, which still opens the task it was aimed at', () => {
    const onOpen = renderCard({
      action: 'update',
      resumeTargetId: 'task:A1b2C3',
      status: 'error',
      launchFailed: true,
      result: REFUSED,
    });

    expect(screen.getByText('chat.taskCard.statusFailed')).toBeInTheDocument();
    expect(screen.getByTestId('subagent-stop-reason')).toHaveTextContent('turned subagents off');
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ subagentId: 'task:A1b2C3' }));
  });

  it('reads as a failed workflow run with its reason, and opens nothing', () => {
    renderCard({
      type: WORKFLOW_TASK_TYPE,
      description: 'ticker-briefs',
      status: 'error',
      launchFailed: true,
      result: REFUSED,
    });

    expect(screen.getByText('chat.taskCard.statusFailed')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-failure-detail')).toHaveTextContent('turned subagents off');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('leaves a spawn that did run, then failed, openable and without its launch reply', () => {
    const onOpen = renderCard({ status: 'error', result: 'Task-A1b2C3 started in the background.' });

    expect(screen.getByText('chat.taskCard.statusFailed')).toBeInTheDocument();
    expect(screen.queryByTestId('subagent-stop-reason')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalled();
  });
});
