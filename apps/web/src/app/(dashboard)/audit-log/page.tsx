'use client';

import { useState, useCallback } from 'react';
import {
  ClipboardList, ChevronLeft, ChevronRight, Loader2, User,
  ChevronDown, ChevronUp, Download,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { auditLogApi, type AuditLogRecord } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { relativeTime } from '@/lib/utils';

// ── Action colour mapping ─────────────────────────────────────

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'muted' | 'default';

const ACTION_STYLES: Record<string, BadgeVariant> = {
  USER_LOGIN:           'success',
  USER_LOGOUT:          'muted',
  USER_CREATED:         'success',
  USER_UPDATED:         'info',
  API_KEY_CREATED:      'success',
  API_KEY_REVOKED:      'danger',
  API_KEY_ROTATED:      'warning',
  WORKSPACE_CREATED:    'success',
  WORKSPACE_UPDATED:    'info',
  WORKSPACE_DELETED:    'danger',
  MEMBER_ADDED:         'success',
  MEMBER_REMOVED:       'danger',
  MEMBER_ROLE_CHANGED:  'warning',
  BUDGET_CREATED:       'success',
  BUDGET_UPDATED:       'info',
  BUDGET_ALERT_SENT:    'warning',
  PROVIDER_ENABLED:     'success',
  PROVIDER_DISABLED:    'danger',
  ROUTING_CONFIG_CHANGED: 'info',
  SETTINGS_UPDATED:     'info',
  WEBHOOK_CREATED:      'success',
  WEBHOOK_UPDATED:      'info',
  WEBHOOK_DELETED:      'danger',
};

function actionBadge(action: string) {
  const variant: BadgeVariant = ACTION_STYLES[action] ?? 'muted';
  const label = action.replace(/_/g, ' ').toLowerCase();
  return <Badge variant={variant}>{label}</Badge>;
}

// ── Metadata detail viewer ─────────────────────────────────────
function MetaCell({ meta }: { meta: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!meta || Object.keys(meta).length === 0) return <span className="text-slate-600">—</span>;

  const prev = typeof meta.previousSlug === 'string' ? meta.previousSlug : null;
  const next = typeof meta.newSlug === 'string' ? meta.newSlug : null;

  if (prev && next) {
    return (
      <span className="text-xs text-slate-300">
        <span className="font-mono text-slate-500">@{prev}</span>
        {' → '}
        <span className="font-mono text-emerald-400">@{next}</span>
      </span>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        details
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-slate-950 p-2 text-[10px] text-slate-300">
          {JSON.stringify(meta, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────
function AuditRow({ entry }: { entry: AuditLogRecord }) {
  return (
    <tr className="border-b border-slate-800/40 transition-colors hover:bg-slate-800/20">
      <td className="px-5 py-3">{actionBadge(entry.action)}</td>
      <td className="px-5 py-3 text-xs text-slate-300">
        {entry.resourceType ? (
          <span>
            <span className="text-slate-500">{entry.resourceType}</span>
            {entry.resourceId && (
              <span className="ml-1 font-mono text-slate-500 text-[10px]">
                #{entry.resourceId.slice(0, 8)}
              </span>
            )}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="px-5 py-3">
        {entry.user ? (
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[10px] font-bold text-white">
              {entry.user.name[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-xs text-white">{entry.user.name}</p>
              <p className="text-[10px] text-slate-500">{entry.user.email}</p>
            </div>
          </div>
        ) : (
          <span className="text-xs text-slate-600">system</span>
        )}
      </td>
      <td className="px-5 py-3 text-xs text-slate-500">{entry.ipAddress ?? '—'}</td>
      <td className="px-5 py-3"><MetaCell meta={entry.metadata} /></td>
      <td className="px-5 py-3 text-xs text-slate-500">{relativeTime(entry.createdAt)}</td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const accessToken = useAuthStore((s) => s.accessToken);
  const PAGE_SIZE = 30;

  const logs = useApi(
    useCallback((t) => auditLogApi.list(t, page, PAGE_SIZE), [page]),
  );

  const pagination = logs.data?.pagination;

  async function handleExport() {
    if (!accessToken) return;
    setExporting(true);
    try {
      await auditLogApi.exportCsv(accessToken, 30);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Immutable record of all workspace actions performed by members and the system
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting || !accessToken}
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export CSV
        </Button>
      </div>

      {/* Table */}
      <Card>
        {logs.loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        ) : !logs.data?.data.length ? (
          <div className="p-5">
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title="No audit log entries yet"
              description="Actions taken by workspace members will appear here"
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-500">
                    {['Action', 'Resource', 'Performed by', 'IP', 'Details', 'Time'].map((h) => (
                      <th key={h} className="px-5 py-3 text-left font-medium uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.data.data.map((entry) => (
                    <AuditRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3">
                <p className="text-xs text-slate-500">
                  Page {pagination.page} of {pagination.totalPages} · {pagination.total.toLocaleString()} entries
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={!pagination.hasPrev}
                    leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!pagination.hasNext}
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Info box */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-start gap-3">
          <User className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
          <p className="text-xs text-slate-400">
            Audit log entries are <strong className="text-slate-300">immutable</strong> and retained for the lifetime of
            your workspace. They record who did what, from which IP, along with relevant metadata. Use this log for
            compliance, debugging, and security reviews.
          </p>
        </div>
      </div>
    </div>
  );
}
