// @vitest-environment node
/**
 * A hand-off or workspace creation the user approved in advance carries no
 * proposal: the server marks the tool result `preapproved` and the card is
 * drawn straight from it (`src/tools/secretary/approvals.py` on the server
 * side). These tests pin that contract; the cache behind `preapprovedCardOf`
 * is pinned where it pays off, in buildRenderBlocks.preapproved.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { preapprovedCard, preapprovedReportBack, preapprovedCardOf } from '../preapprovedCards';

const ptcResult = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    success: true,
    preapproved: true,
    workspace_id: 'ws-1',
    workspace_name: 'Semiconductors',
    thread_id: 'thread-1',
    report_back: true,
    ...overrides,
  });

describe('preapprovedCard', () => {
  it.each(['delegate_to_analyst', 'ptc_agent'])('builds an approved ptc_agent proposal for %s', (toolName) => {
    const card = preapprovedCard(toolName, { question: 'Is NVDA overvalued?' }, ptcResult());
    expect(card).toEqual({
      type: 'ptc_agent',
      proposal: {
        status: 'approved',
        question: 'Is NVDA overvalued?',
        workspace_id: 'ws-1',
        workspace_name: 'Semiconductors',
        thread_id: 'thread-1',
        report_back: true,
      },
    });
  });

  it('reads report_back false when the result does not say true', () => {
    const card = preapprovedCard('ptc_agent', { question: 'Q' }, ptcResult({ report_back: false }));
    expect(card?.proposal.report_back).toBe(false);
  });

  it('falls back to an empty question when args carry no string one', () => {
    expect(preapprovedCard('ptc_agent', { question: 42 }, ptcResult())?.proposal.question).toBe('');
    expect(preapprovedCard('ptc_agent', undefined, ptcResult())?.proposal.question).toBe('');
  });

  it('builds an approved create_workspace proposal for manage_workspaces', () => {
    const card = preapprovedCard(
      'manage_workspaces',
      { action: 'create' },
      JSON.stringify({
        success: true,
        preapproved: true,
        workspace_name: 'New Workspace',
        workspace_description: 'A fresh workspace',
      }),
    );
    expect(card).toEqual({
      type: 'create_workspace',
      proposal: {
        status: 'approved',
        workspace_name: 'New Workspace',
        workspace_description: 'A fresh workspace',
      },
    });
  });

  it('returns null when the result carries no preapproved flag', () => {
    expect(preapprovedCard('ptc_agent', { question: 'Q' }, JSON.stringify({ success: true }))).toBeNull();
  });

  it('returns null when the call did not succeed', () => {
    expect(preapprovedCard('ptc_agent', { question: 'Q' }, ptcResult({ success: false }))).toBeNull();
  });

  it('returns null for non-JSON content', () => {
    expect(preapprovedCard('ptc_agent', { question: 'Q' }, 'plain text result')).toBeNull();
  });

  it('returns null for non-string content', () => {
    expect(preapprovedCard('ptc_agent', { question: 'Q' }, { success: true, preapproved: true })).toBeNull();
  });

  it('returns null for a tool name that is not a recognized hand-off or workspace action', () => {
    expect(preapprovedCard('bash', {}, ptcResult())).toBeNull();
  });
});

describe('preapprovedReportBack', () => {
  it('is true only for a preapproved, dispatched result with report_back true', () => {
    expect(preapprovedReportBack(ptcResult({ status: 'dispatched', report_back: true }))).toBe(true);
  });

  it('is false when report_back is not true', () => {
    expect(preapprovedReportBack(ptcResult({ status: 'dispatched', report_back: false }))).toBe(false);
  });

  it('is false when the status is not dispatched', () => {
    expect(preapprovedReportBack(ptcResult({ status: 'other', report_back: true }))).toBe(false);
  });

  it('is false for a dispatched result that was not preapproved (asked first)', () => {
    expect(
      preapprovedReportBack(
        JSON.stringify({ success: true, status: 'dispatched', report_back: true }),
      ),
    ).toBe(false);
  });

  it('is false for non-JSON content', () => {
    expect(preapprovedReportBack('nope')).toBe(false);
  });
});

describe('preapprovedCardOf', () => {
  it('returns null when there is no result', () => {
    expect(preapprovedCardOf(undefined)).toBeNull();
    expect(preapprovedCardOf({ toolName: 'ptc_agent' })).toBeNull();
  });
});
