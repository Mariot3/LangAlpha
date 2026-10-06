/**
 * warmWorkspace — proactive sandbox warming primitive.
 *
 * Shared between gallery click handlers and mount-time hooks so both call
 * sites go through the same dedupe Map. The backend's /start?lazy=true
 * returns 202 immediately and continues the restart in a background task.
 *
 * Best-effort: 4xx, 404, and network errors are swallowed silently. The
 * chat-time get_session_for_workspace path will surface real errors with
 * proper UX when the user actually sends a message.
 */
import { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import type { ComputersResponse, Workspace, WorkspacesResponse } from '@/types/api';

import { startWorkspace } from './api';
import { workspaceDetailQuery } from './workspaceQueries';

const inFlight = new Map<string, Promise<void>>();

/**
 * Every workspace the list caches currently hold, across pages and sort orders.
 *
 * The one place that knows the shape those entries have, so a reader asking
 * "what does the app believe about the workspaces right now" does not sniff a
 * cache value or cast it.
 */
export function cachedWorkspaceLists(queryClient: QueryClient): Workspace[] {
  const rows: Workspace[] = [];
  const entries = queryClient.getQueriesData<WorkspacesResponse>({
    queryKey: queryKeys.workspaces.lists(),
  });
  for (const [, data] of entries) {
    if (data?.workspaces) rows.push(...data.workspaces);
  }
  return rows;
}

/**
 * A flash row's 'flash' status is a marker, not a lifecycle state: it is how
 * every surface tells the per-user flash row (Home, once bound) apart. A
 * bound Home row carries its computer's id, so a computer-wide patch would
 * otherwise overwrite the marker with the machine's state.
 */
function holdsFlashMarker(row: { status?: string | null } | null | undefined): boolean {
  return row?.status === 'flash';
}

/**
 * Write `status` into both the workspace detail cache and any active
 * workspace-list caches. Shared between `warmWorkspace` (writes the
 * 202 /start response) and `useWarmWorkspaceSandbox` (writes each
 * SSE-pushed transition) so a single status change visibly updates
 * every gallery + detail consumer without a network round-trip. A flash
 * row keeps its marker.
 */
export function patchWorkspaceStatusInCaches(
  queryClient: QueryClient,
  workspaceId: string,
  status: string,
  computerId?: string,
): void {
  queryClient.setQueryData(
    workspaceDetailQuery(workspaceId).queryKey,
    (prev) => prev && !holdsFlashMarker(prev)
      ? { ...prev, status, ...(computerId ? { computer_id: computerId } : {}) }
      : prev,
  );
  queryClient.setQueriesData<WorkspacesResponse | undefined>(
    { queryKey: queryKeys.workspaces.lists() },
    (prev) => {
      if (!prev?.workspaces) return prev;
      return {
        ...prev,
        workspaces: prev.workspaces.map((w) =>
          w.workspace_id === workspaceId && !holdsFlashMarker(w)
            ? { ...w, status, ...(computerId ? { computer_id: computerId } : {}) }
            : w,
        ),
      };
    },
  );
}

/** Update one machine and every cached workspace bound to it, except a flash
 * row, whose status stays its marker. */
export function patchComputerStatusInCaches(
  queryClient: QueryClient,
  computerId: string,
  status: string,
): void {
  queryClient.setQueriesData<ComputersResponse | undefined>(
    { queryKey: queryKeys.computers.lists() },
    (prev) => !prev?.computers ? prev : {
      ...prev,
      computers: prev.computers.map((computer) =>
        computer.computer_id === computerId ? { ...computer, status } : computer,
      ),
    },
  );
  queryClient.setQueriesData<Workspace | undefined>(
    { queryKey: queryKeys.workspaces.details() },
    (prev) => prev?.computer_id === computerId && prev.status !== 'deleted' && !holdsFlashMarker(prev)
      ? { ...prev, status }
      : prev,
  );
  const workspaceIds = new Set(
    cachedWorkspaceLists(queryClient)
      .filter((workspace) =>
        workspace.computer_id === computerId && workspace.status !== 'deleted'
        && !holdsFlashMarker(workspace))
      .map((workspace) => workspace.workspace_id),
  );
  for (const id of workspaceIds) patchWorkspaceStatusInCaches(queryClient, id, status);
}

/** The computer Home is bound to, from whichever cache holds its row; null
 * until the first start binds it. */
function homeComputerId(queryClient: QueryClient, workspaceId: string): string | null {
  const row = queryClient.getQueryData<Workspace>(queryKeys.workspaces.flash())
    ?? queryClient.getQueryData(workspaceDetailQuery(workspaceId).queryKey)
    ?? cachedWorkspaceLists(queryClient).find((w) => w.workspace_id === workspaceId);
  return row?.workspace_id === workspaceId ? (row.computer_id ?? null) : null;
}

/** What the caches believe a machine is doing: its own row, else a workspace
 * bound to it. */
function cachedComputerStatus(queryClient: QueryClient, computerId: string): string | undefined {
  for (const [, data] of queryClient.getQueriesData<ComputersResponse>({ queryKey: queryKeys.computers.lists() })) {
    const computer = data?.computers?.find((c) => c.computer_id === computerId);
    if (computer) return computer.status;
  }
  return cachedWorkspaceLists(queryClient)
    .find((w) => w.computer_id === computerId && !holdsFlashMarker(w) && w.status !== 'deleted')
    ?.status;
}

/** Two-level warming state the chat spinner renders: not warming, a generic
 * start, or a slow restore from cold storage. */
export type WarmingDisplay = false | 'starting' | 'archived';

/**
 * Merge the chat-path start signal (`workspaceStarting`) with the entry-time
 * warm signal (`warmingState`) into the single state the spinner shows.
 * 'archived' from EITHER source wins so a slow cold-storage restore always
 * gets the longer-wait copy even when only one source observed the refinement;
 * otherwise the first truthy signal shows.
 */
export function mergeWarmingDisplay(
  workspaceStarting: WarmingDisplay,
  warmingState: WarmingDisplay,
): WarmingDisplay {
  if (workspaceStarting === 'archived' || warmingState === 'archived') {
    return 'archived';
  }
  return workspaceStarting || warmingState || false;
}

export function warmWorkspace(
  workspaceId: string,
  queryClient: QueryClient,
  { home = false }: {
    /**
     * The per-user flash row under the all-workspaces agent. Its row reads
     * 'flash' whatever its computer is doing, so the status gate below would
     * skip it; the start itself binds Home to the computer and answers from
     * the computer's state. Leave unset with the flag off, where a start on
     * that row is refused.
     */
    home?: boolean;
  } = {},
): Promise<void> {
  if (!workspaceId) return Promise.resolve();

  const existing = inFlight.get(workspaceId);
  if (existing) return existing;

  if (home) {
    // Home's row keeps its 'flash' marker; the start moves its computer, which
    // the workspaces beside it on that machine show, so patch the machine.
    const p = startWorkspace(workspaceId, { lazy: true })
      .then((resp) => {
        const computerId = homeComputerId(queryClient, workspaceId);
        if (computerId && cachedComputerStatus(queryClient, computerId) === 'stopped') {
          patchComputerStatusInCaches(queryClient, computerId, resp.status);
        }
      })
      .catch((err: unknown) => {
        if (import.meta.env?.DEV) {
          console.warn('[warmWorkspace] failed', workspaceId, err);
        }
      })
      .finally(() => inFlight.delete(workspaceId));
    inFlight.set(workspaceId, p);
    return p;
  }

  const cached = queryClient.getQueryData(workspaceDetailQuery(workspaceId).queryKey);
  if (cached && cached.status && !['stopped', 'running'].includes(cached.status)) {
    return Promise.resolve();
  }

  const p = (async () => {
    try {
      const detail = cached ?? (await queryClient.fetchQuery(workspaceDetailQuery(workspaceId)));
      if (!detail?.status || !['stopped', 'running'].includes(detail.status)) return;

      const resp = await startWorkspace(workspaceId, { lazy: true });
      // Only reflect the 202 'starting' if nothing has advanced the cache past
      // 'stopped' meanwhile. The SSE stream (useWarmWorkspaceSandbox) can push
      // a fast 'running' (or 'error') before this slower patch lands; without
      // the guard, 'starting' would clobber it and wedge the UI on 'starting'
      // until the next refetch.
      const current = queryClient.getQueryData(workspaceDetailQuery(workspaceId).queryKey);
      if (!current?.status || current.status === 'stopped') {
        if (detail.computer_id) {
          patchComputerStatusInCaches(queryClient, detail.computer_id, resp.status);
        } else {
          patchWorkspaceStatusInCaches(queryClient, workspaceId, resp.status);
        }
      }
    } catch (err) {
      // Best-effort warming — chat-time start path surfaces real errors with
      // proper UX. Log in dev so programmer mistakes (URL typos, response
      // shape changes) don't disappear silently.
      if (import.meta.env?.DEV) {
        console.warn('[warmWorkspace] failed', workspaceId, err);
      }
    } finally {
      inFlight.delete(workspaceId);
    }
  })();

  inFlight.set(workspaceId, p);
  return p;
}

export function __resetWarmStateForTests(): void {
  inFlight.clear();
}
