import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { AUTO_APPROVE, useAutoApprove, type AutoApproveKey } from '@/hooks/useAutoApprove';
import { useAllWorkspacesAgent } from '@/hooks/useAllWorkspacesAgent';

const ROWS: { key: AutoApproveKey; label: string; description: string }[] = [
  { key: AUTO_APPROVE.handoffs, label: 'settings.autoApproveHandoffs', description: 'settings.autoApproveHandoffsDesc' },
  {
    key: AUTO_APPROVE.workspaceCreation,
    label: 'settings.autoApproveWorkspaceCreation',
    description: 'settings.autoApproveWorkspaceCreationDesc',
  },
];

function AutoApproveRow({ settingKey, label, description }: { settingKey: AutoApproveKey; label: string; description: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { enabled, set } = useAutoApprove(settingKey);
  const toggle = () => {
    set(!enabled).catch(() => {
      toast({ variant: 'destructive', title: t('common.error'), description: t('settings.failedToSaveSettings') });
    });
  };
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t(label)}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{t(description)}</p>
      </div>
      <ToggleSwitch checked={enabled} onChange={toggle} className="mt-0.5" ariaLabel={t(label)} />
    </div>
  );
}

/** The agent actions the user approved in advance, each turned back to asking here. */
export function AutoApproveSettings() {
  const { t } = useTranslation();
  // With the flag off a hand-off goes to a PTC workspace, which has no Analyst.
  const allWorkspaces = useAllWorkspacesAgent();
  return (
    <div className="p-3 rounded-lg space-y-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-muted)' }}>
      <p className="text-[0.8125rem] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('settings.approvals')}</p>
      {ROWS.map((row) => (
        <AutoApproveRow
          key={row.key}
          settingKey={row.key}
          label={row.label}
          description={row.key === AUTO_APPROVE.handoffs && !allWorkspaces ? 'settings.autoApproveHandoffsDescPtc' : row.description}
        />
      ))}
    </div>
  );
}
