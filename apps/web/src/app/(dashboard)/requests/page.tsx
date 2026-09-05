'use client';

import { useState, useCallback, useEffect } from 'react';
import { Search, ChevronLeft, ChevronRight, RefreshCcw, X, Download, Loader2, Play } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { analyticsApi, SmartRouteApiError, type RequestRecord, type RequestDetail } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useWorkspaceRole } from '@/hooks/useWorkspaceRole';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { formatCurrency, formatLatency, relativeTime, truncate } from '@/lib/utils';

// ── Status badge ──────────────────────────────────────────────
function statusBadge(status: string) {
  const map: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'muted'> = {
    COMPLETED: 'success',
    CACHED: 'warning',
    FAILED: 'danger',
    RATE_LIMITED: 'danger',
    BUDGET_EXCEEDED: 'danger',
    PROCESSING: 'info',
    PENDING: 'muted',
  };
  return <Badge variant={map[status] ?? 'muted'}>{status.toLowerCase().replace('_', ' ')}</Badge>;
}

// ── Complexity badge ──────────────────────────────────────────
function complexityBadge(level: string | null) {
  if (!level) return null;
  const map: Record<string, 'success' | 'warning' | 'danger'> = {
    SIMPLE: 'success',
    MEDIUM: 'warning',
    COMPLEX: 'danger',
  };
  return <Badge variant={map[level] ?? 'muted'}>{level.toLowerCase()}</Badge>;
}

// ── Trace drawer ──────────────────────────────────────────────
function TraceDrawer({
  request,
  accessToken,
  canWrite,
  onClose,
  onReplayed,
}: {
  request: RequestRecord;
  accessToken: string | null;
  canWrite: boolean;
  onClose: () => void;
  onReplayed: () => void;
}) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState('');
  const [replayResult, setReplayResult] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    setLoadingDetail(true);
    analyticsApi
      .requestDetail(accessToken, request.id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [accessToken, request.id]);

  async function handleReplay() {
    if (!accessToken) return;
    setReplaying(true);
    setReplayError('');
    setReplayResult(null);
    try {
      const { response } = await analyticsApi.replayRequest(accessToken, request.id);
      setReplayResult(response.message);
      onReplayed();
    } catch (err) {
      setReplayError(err instanceof SmartRouteApiError ? err.message : 'Replay failed');
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <h3 className="font-semibold text-white">Request Trace</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReplay}
            disabled={replaying || !accessToken || !canWrite}
            title={canWrite ? 'Replay this request through the gateway' : 'Viewers cannot replay requests'}
            className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
          >
            {replaying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Replay
          </button>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {replayError && (
          <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-3 py-2 text-xs text-red-400">
            {replayError}
          </div>
        )}
        {replayResult && (
          <div className="rounded-lg border border-green-800/50 bg-green-900/20 p-3 space-y-1">
            <p className="text-xs font-semibold text-green-400">Replay response</p>
            <p className="text-xs text-slate-300 whitespace-pre-wrap">{replayResult}</p>
          </div>
        )}

        {/* IDs */}
        <div className="rounded-lg bg-slate-800 p-3 space-y-1.5">
          <Row label="Request ID" value={<code className="text-xs text-blue-400 break-all">{request.id}</code>} />
          <Row label="Trace ID" value={<code className="text-xs text-purple-400 break-all">{request.traceId}</code>} />
        </div>

        {/* Prompt */}
        <Section title="Prompt">
          {loadingDetail ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : (
            <>
              {detail?.systemPrompt && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] uppercase text-slate-500">System</p>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap">{detail.systemPrompt}</p>
                </div>
              )}
              <p className="text-xs text-slate-300 whitespace-pre-wrap">{detail?.prompt ?? '—'}</p>
              {detail?.response && (
                <div className="mt-3 border-t border-slate-700 pt-2">
                  <p className="mb-1 text-[10px] uppercase text-slate-500">Original response</p>
                  <p className="text-xs text-slate-400 whitespace-pre-wrap">{detail.response}</p>
                </div>
              )}
            </>
          )}
        </Section>

        {/* Routing */}
        <Section title="Routing">
          <Row label="Status" value={statusBadge(request.status)} />
          <Row label="Provider" value={request.model?.provider ?? '—'} />
          <Row label="Model" value={request.model?.modelId ?? request.requestedModel ?? '—'} />
          <Row label="Complexity" value={complexityBadge(request.complexityLevel) ?? '—'} />
          <Row label="Cache Hit" value={request.cacheHit ? '✓ Yes' : '✗ No'} />
          <Row label="Fallback Used" value={request.fallbackUsed ? '✓ Yes' : '✗ No'} />
          <Row label="Retry Count" value={request.retryCount.toString()} />
        </Section>

        {/* Cost */}
        <Section title="Cost & Tokens">
          <Row label="Actual Cost" value={request.actualCostUsd ? formatCurrency(request.actualCostUsd, 6) : '—'} />
          <Row label="Savings" value={request.savingsUsd ? formatCurrency(request.savingsUsd, 6) : '—'} />
          <Row label="Input Tokens" value={request.inputTokens?.toLocaleString() ?? '—'} />
          <Row label="Output Tokens" value={request.outputTokens?.toLocaleString() ?? '—'} />
        </Section>

        {/* Performance */}
        <Section title="Performance">
          <Row label="Total Latency" value={request.totalLatencyMs ? formatLatency(request.totalLatencyMs) : '—'} />
          <Row label="Created" value={new Date(request.createdAt).toLocaleString()} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-medium text-white">{value}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function RequestsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RequestRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const accessToken = useAuthStore((s) => s.accessToken);
  const { canWrite } = useWorkspaceRole();

  const requests = useApi(
    useCallback((token) => analyticsApi.requests(token, page, 25), [page]),
    [page],
  );

  async function handleExportCsv() {
    if (!accessToken) return;
    setExporting(true);
    try {
      await analyticsApi.exportCsv(accessToken, 30);
    } catch {
      // silently fail — user sees no download
    } finally {
      setExporting(false);
    }
  }

  const filtered =
    search.trim()
      ? requests.data?.data.filter(
          (r) =>
            r.id.includes(search) ||
            r.traceId.includes(search) ||
            (r.model?.modelId ?? '').includes(search.toLowerCase()),
        )
      : requests.data?.data;

  return (
    <>
      {/* Trace drawer backdrop */}
      {selected && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        />
      )}
      {selected && (
        <TraceDrawer
          request={selected}
          accessToken={accessToken}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onReplayed={requests.refetch}
        />
      )}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Request Explorer</h1>
            <p className="mt-0.5 text-sm text-slate-400">
              {requests.data?.pagination.total.toLocaleString() ?? '…'} total requests
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Export CSV
            </button>
            <button
              onClick={requests.refetch}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white"
            >
              <RefreshCcw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by request ID, trace ID, or model…"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Table */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  {['Request ID', 'Status', 'Model', 'Complexity', 'Tokens', 'Cost', 'Latency', 'Time'].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {requests.loading ? (
                  Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={i} cols={8} />)
                ) : !filtered?.length ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        title="No requests yet"
                        description="Requests will appear here once you start calling POST /api/v1/chat"
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((req) => (
                    <tr
                      key={req.id}
                      onClick={() => setSelected(req)}
                      className="cursor-pointer transition-colors hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-mono text-xs text-blue-400">{truncate(req.id, 16)}</p>
                          {req.cacheHit && (
                            <Badge variant="warning" className="mt-0.5">cached</Badge>
                          )}
                          {req.fallbackUsed && (
                            <Badge variant="danger" className="mt-0.5 ml-1">fallback</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{statusBadge(req.status)}</td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-medium text-white">{req.model?.modelId ?? req.requestedModel ?? '—'}</p>
                        <p className="text-xs text-slate-500">{req.model?.provider ?? ''}</p>
                      </td>
                      <td className="px-4 py-3">{complexityBadge(req.complexityLevel)}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {req.inputTokens !== null ? (
                          <>
                            <span className="text-white">{(req.inputTokens + (req.outputTokens ?? 0)).toLocaleString()}</span>
                            <span className="ml-1 text-slate-600">tok</span>
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-white">
                        {req.actualCostUsd ? formatCurrency(req.actualCostUsd, 5) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {req.totalLatencyMs ? formatLatency(req.totalLatencyMs) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{relativeTime(req.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {requests.data && requests.data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
              <p className="text-xs text-slate-500">
                Page {requests.data.pagination.page} of {requests.data.pagination.totalPages} ·{' '}
                {requests.data.pagination.total.toLocaleString()} results
              </p>
              <div className="flex items-center gap-2">
                <button
                  disabled={!requests.data.pagination.hasPrev}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  disabled={!requests.data.pagination.hasNext}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
