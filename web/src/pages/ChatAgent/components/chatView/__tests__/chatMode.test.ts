// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { resolveChatMode } from '../chatMode';

const off = { allWorkspacesAgent: false, navAgentMode: undefined, navIsFlash: false, rowStatus: undefined };
const on = { ...off, allWorkspacesAgent: true };

describe('resolveChatMode with the all-workspaces agent off', () => {
  it('runs Flash on the flash row, named by the row alone', () => {
    expect(resolveChatMode({ ...off, rowStatus: 'flash' })).toEqual({ isHome: false, agentMode: 'flash', isFlashMode: true, dispatches: true });
  });

  it('runs Flash when the navigation asked for it', () => {
    expect(resolveChatMode({ ...off, navAgentMode: 'flash' })).toEqual({ isHome: false, agentMode: 'flash', isFlashMode: true, dispatches: true });
  });

  it('keeps a flash status from the navigation over an unloaded row', () => {
    expect(resolveChatMode({ ...off, navIsFlash: true })).toEqual({ isHome: false, agentMode: 'ptc', isFlashMode: true, dispatches: true });
  });

  it('runs PTC in a workspace', () => {
    expect(resolveChatMode({ ...off, rowStatus: 'running' })).toEqual({ isHome: false, agentMode: 'ptc', isFlashMode: false, dispatches: false });
  });
});

describe('resolveChatMode with the all-workspaces agent on', () => {
  it.each([
    ['the row', { rowStatus: 'flash' }],
    ['a flash status from the navigation', { navIsFlash: true }],
    ['a Flash mode from the navigation', { navAgentMode: 'flash' }],
  ])('runs the flash row as Home, a PTC agent, when %s names it', (_, named) => {
    expect(resolveChatMode({ ...on, ...named })).toEqual({ isHome: true, agentMode: 'ptc', isFlashMode: false, dispatches: true });
  });

  it('leaves every other workspace as it was', () => {
    expect(resolveChatMode({ ...on, rowStatus: 'stopped' })).toEqual({ isHome: false, agentMode: 'ptc', isFlashMode: false, dispatches: false });
  });
});
