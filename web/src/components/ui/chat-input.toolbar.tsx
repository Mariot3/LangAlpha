import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Check, ChevronDown, FileStack, FolderOpen, Layers, Radar, Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from './dropdown-menu';
import { IconToggle, PillToggle, SubagentsGlyph } from './chat-input.parts';
import type { ToolbarItem } from './chat-input.useToolbarFold';
import type { ComposerScope, Workspace } from './chat-input.types';

/**
 * The composer's foldable toolbar, declared once in PRIORITY order: the first
 * item is the last to fold, and that same order is the inline render order, so
 * folding only ever removes controls from the tail — nothing shifts position.
 *
 * Each item carries its inline render, its ⋯-menu render and a group tag;
 * separators between groups are emitted by the menu loop, never by hand.
 */
export function useToolbarItems({
  mode,
  onModeChange,
  ptcDisabledReason,
  subagentsAllowed,
  onToggleSubagents,
  watchMode,
  setWatchMode,
  marketWatchEnabled,
  workspaces,
  selectedWorkspaceId,
  onWorkspaceChange,
  scope,
  onScopeChange,
  emptyWorkspacesHint,
}: {
  mode?: 'fast' | 'ptc';
  onModeChange?: (mode: 'fast' | 'ptc') => void;
  ptcDisabledReason?: string | null;
  /** Null while the thread's value is not read, which hides the toggle. */
  subagentsAllowed: boolean | null;
  onToggleSubagents: (next: boolean) => void;
  watchMode: boolean;
  setWatchMode: (v: boolean) => void;
  marketWatchEnabled: boolean;
  workspaces?: Workspace[] | null;
  selectedWorkspaceId?: string | null;
  onWorkspaceChange?: ((wsId: string) => void) | null;
  scope?: ComposerScope;
  onScopeChange?: ((scope: ComposerScope) => void) | null;
  emptyWorkspacesHint?: string | null;
}): ToolbarItem[] {
  const { t } = useTranslation();

  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const workspaceBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showWorkspaceMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (workspaceBtnRef.current?.contains(e.target as Node)) return;
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setShowWorkspaceMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showWorkspaceMenu]);

  const hasModeToggle = mode !== undefined && onModeChange !== undefined;
  // Under the all-workspaces agent there is no Flash/PTC choice, only where the
  // agent works, so the host passes a scope and no mode.
  const hasScopePicker = !!onScopeChange;
  // PTC unless the composer says flash: a host with no mode toggle either
  // enforces PTC (no mode at all) or names the thread's mode.
  const ptcSelected = mode !== 'fast';
  const showWorkspaceSelector = !!(hasModeToggle && mode === 'ptc' && workspaces && workspaces.length > 0);
  const ptcBlocked = mode === 'fast' && !!ptcDisabledReason;
  const selectedWorkspaceName = useMemo(() => {
    if (!workspaces || !selectedWorkspaceId) return 'Workspace';
    return workspaces.find((w) => w.workspace_id === selectedWorkspaceId)?.name || 'Workspace';
  }, [workspaces, selectedWorkspaceId]);

  const allSelected = scope === 'all';
  const scopeLabel = allSelected
    ? t('agents.allWorkspaces')
    : workspaces?.find((w) => w.workspace_id === selectedWorkspaceId)?.name || t('nav.workspaceFallback');
  // Shown in the picker when the host can say why its workspace list is empty.
  const noWorkspacesHint = !workspaces?.length ? emptyWorkspacesHint : null;
  const hasSecondSection = !!workspaces?.length || !!noWorkspacesHint;
  const pickAll = useCallback(() => {
    if (scope !== 'all') onScopeChange?.('all');
  }, [scope, onScopeChange]);
  // Workspace before scope, so a host keyed on the active workspace never
  // pairs the workspace scope with the previously selected workspace.
  const pickWorkspace = useCallback((id: string) => {
    if (id !== selectedWorkspaceId) onWorkspaceChange?.(id);
    if (scope !== 'workspace') onScopeChange?.('workspace');
  }, [scope, onScopeChange, selectedWorkspaceId, onWorkspaceChange]);

  const subagentsOn = subagentsAllowed === true;

  return useMemo<ToolbarItem[]>(() => [
    {
      id: 'scope',
      group: 'agent',
      // Takes the mode toggle's slot: it is the one control that says where a
      // send goes, so it is the last to fold.
      visible: hasScopePicker,
      inline: ({ measureOnly }) => {
        const pill = (
          <PillToggle
            active={showWorkspaceMenu}
            onToggle={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
            icon={allSelected ? Layers : FolderOpen}
            label={scopeLabel}
            title={t('agents.pickWhere')}
            trailing={<ChevronDown className="h-3 w-3 flex-none" />}
            aria="expanded"
            gap={4}
            className="min-w-0"
            labelClassName="min-w-0 max-w-[120px] truncate"
            buttonRef={measureOnly ? undefined : workspaceBtnRef}
            measureOnly={measureOnly}
          />
        );
        if (measureOnly) return pill;
        const choose = (pick: () => void) => (e: ReactMouseEvent) => {
          e.preventDefault();
          pick();
          setShowWorkspaceMenu(false);
        };
        return (
          <div className="relative flex min-w-0" ref={workspaceMenuRef}>
            {pill}
            {showWorkspaceMenu && (
              <div className="workspace-dropdown workspace-dropdown-up">
                <div
                  title={t('agents.allWorkspacesHint')}
                  className={`workspace-dropdown-item ${allSelected ? 'active' : ''}`}
                  onMouseDown={choose(pickAll)}
                >
                  <Layers className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                  <span>{t('agents.allWorkspaces')}</span>
                </div>
                {hasSecondSection && (
                  <div aria-hidden style={{ height: 1, margin: '4px 0', background: 'var(--color-border-muted)' }} />
                )}
                {workspaces?.map((ws) => (
                  <div
                    key={ws.workspace_id}
                    className={`workspace-dropdown-item ${!allSelected && ws.workspace_id === selectedWorkspaceId ? 'active' : ''}`}
                    onMouseDown={choose(() => pickWorkspace(ws.workspace_id))}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                    <span className="min-w-0 truncate" title={ws.name}>{ws.name}</span>
                  </div>
                ))}
                {noWorkspacesHint && (
                  <div style={{ padding: '6px 14px 8px', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                    {noWorkspacesHint}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      },
      menu: () => (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {allSelected ? <Layers className="h-4 w-4 flex-none" /> : <FolderOpen className="h-4 w-4 flex-none" />}
            <span className="min-w-0 max-w-[120px] truncate">{scopeLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
            <DropdownMenuItem title={t('agents.allWorkspacesHint')} onSelect={pickAll}>
              <Layers className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('agents.allWorkspaces')}</span>
              {allSelected && <Check className="ml-auto h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
            {hasSecondSection && <DropdownMenuSeparator />}
            {workspaces?.map((ws) => (
              <DropdownMenuItem key={ws.workspace_id} onSelect={() => pickWorkspace(ws.workspace_id)}>
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate">{ws.name}</span>
                {!allSelected && ws.workspace_id === selectedWorkspaceId && <Check className="ml-auto h-4 w-4 shrink-0" />}
              </DropdownMenuItem>
            ))}
            {noWorkspacesHint && (
              <DropdownMenuItem disabled>
                <span className="text-xs">{noWorkspacesHint}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ),
    },
    {
      id: 'mode',
      group: 'agent',
      visible: hasModeToggle,
      inline: ({ measureOnly }) => (
        <PillToggle
          icon={mode === 'fast' ? Zap : FileStack}
          label={mode === 'fast' ? 'Flash' : 'PTC'}
          title={mode === 'fast'
            ? 'Flash — quick answer using flash model'
            : 'PTC — full agent with workspace and tools'}
          disabledReason={ptcBlocked ? ptcDisabledReason : null}
          aria="none"
          onToggle={() => onModeChange?.(mode === 'fast' ? 'ptc' : 'fast')}
          measureOnly={measureOnly}
        />
      ),
      menu: () => (
        <>
          <DropdownMenuItem onSelect={() => { if (mode !== 'fast') onModeChange?.('fast'); }}>
            <Zap className="h-4 w-4" />
            <span>Flash</span>
            {mode === 'fast' && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={ptcBlocked}
            title={ptcBlocked ? ptcDisabledReason! : undefined}
            onSelect={() => { if (mode !== 'ptc') onModeChange?.('ptc'); }}
          >
            <FileStack className="h-4 w-4" />
            <span>PTC</span>
            {mode === 'ptc' && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        </>
      ),
    },
    {
      id: 'subagents',
      group: 'toggle',
      // Subagents are a PTC capability. Pressed means on, the default, so the
      // ⋯ dot stays off: lit for the usual state it would never mean anything.
      visible: ptcSelected && subagentsAllowed !== null,
      inline: ({ measureOnly }) => (
        <IconToggle
          active={subagentsOn}
          onToggle={() => onToggleSubagents(!subagentsOn)}
          label={t('chat.pills.subagents')}
          tooltip={t(subagentsOn ? 'chat.pills.subagentsOn' : 'chat.pills.subagentsOff')}
          measureOnly={measureOnly}
        >
          <SubagentsGlyph on={subagentsOn} />
        </IconToggle>
      ),
      menu: () => (
        <DropdownMenuItem
          onSelect={(e) => { e.preventDefault(); onToggleSubagents(!subagentsOn); }}
        >
          <SubagentsGlyph
            on={subagentsOn}
            style={subagentsOn ? { color: 'var(--color-accent-light)' } : undefined}
          />
          <span>{t('chat.pills.subagents')}</span>
          {subagentsOn && <Check className="ml-auto h-4 w-4" style={{ color: 'var(--color-accent-light)' }} />}
        </DropdownMenuItem>
      ),
    },
    {
      id: 'watch',
      group: 'toggle',
      // Market watch is a PTC capability too.
      visible: ptcSelected && marketWatchEnabled,
      active: watchMode,
      inline: ({ measureOnly }) => (
        <PillToggle
          active={watchMode}
          onToggle={() => setWatchMode(!watchMode)}
          icon={Radar}
          label={t('chat.pills.watch')}
          title={t('chat.pills.watchTitle')}
          measureOnly={measureOnly}
        />
      ),
      menu: () => (
        <DropdownMenuItem
          title={t('chat.pills.watchTitle')}
          onSelect={(e) => { e.preventDefault(); setWatchMode(!watchMode); }}
        >
          <Radar className="h-4 w-4" style={watchMode ? { color: 'var(--color-accent-light)' } : undefined} />
          <span>{t('chat.pills.watch')}</span>
          {watchMode && <Check className="ml-auto h-4 w-4" style={{ color: 'var(--color-accent-light)' }} />}
        </DropdownMenuItem>
      ),
    },
    {
      id: 'workspace',
      group: 'workspace',
      // Widest and least-toggled, so it folds first.
      visible: showWorkspaceSelector,
      inline: ({ measureOnly }) => {
        const pill = (
          <PillToggle
            active={showWorkspaceMenu}
            onToggle={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
            icon={FolderOpen}
            label={selectedWorkspaceName}
            title="Select workspace"
            trailing={<ChevronDown className="h-3 w-3 flex-none" />}
            aria="expanded"
            gap={4}
            className="min-w-0"
            labelClassName="min-w-0 max-w-[100px] truncate"
            buttonRef={measureOnly ? undefined : workspaceBtnRef}
            measureOnly={measureOnly}
          />
        );
        if (measureOnly) return pill;
        return (
          <div className="relative flex min-w-0" ref={workspaceMenuRef}>
            {pill}
            {showWorkspaceMenu && (
              <div className="workspace-dropdown workspace-dropdown-up">
                {workspaces?.map((ws) => (
                  <div
                    key={ws.workspace_id}
                    className={`workspace-dropdown-item ${ws.workspace_id === selectedWorkspaceId ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onWorkspaceChange?.(ws.workspace_id);
                      setShowWorkspaceMenu(false);
                    }}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                    <span>{ws.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      },
      menu: () => (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderOpen className="h-4 w-4 flex-none" />
            <span className="min-w-0 max-w-[120px] truncate">{selectedWorkspaceName}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
            {workspaces?.map((ws) => (
              <DropdownMenuItem
                key={ws.workspace_id}
                onSelect={() => onWorkspaceChange?.(ws.workspace_id)}
              >
                <span className="truncate">{ws.name}</span>
                {ws.workspace_id === selectedWorkspaceId && <Check className="ml-auto h-4 w-4 shrink-0" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ),
    },
  ], [
    hasModeToggle, mode, onModeChange, ptcBlocked, ptcDisabledReason,
    ptcSelected, subagentsAllowed, subagentsOn, onToggleSubagents,
    watchMode, setWatchMode, marketWatchEnabled,
    showWorkspaceSelector, showWorkspaceMenu, selectedWorkspaceName,
    workspaces, selectedWorkspaceId, onWorkspaceChange, t,
    hasScopePicker, allSelected, scopeLabel, noWorkspacesHint, hasSecondSection,
    pickAll, pickWorkspace,
  ]);
}
