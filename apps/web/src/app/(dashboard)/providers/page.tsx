'use client';

import { useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCcw,
  Activity,
  Wifi,
  Clock,
  Loader2,
} from 'lucide-react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useApi } from '@/hooks/useApi';
import { workspaceApi, infraHealthApi, type ProviderHealthRecord } from '@/lib/api';
import { useWorkspaceRole } from '@/hooks/useWorkspaceRole';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatLatency, relativeTime } from '@/lib/utils';

// ── Status icon ───────────────────────────────────────────────
function StatusIcon({ status }: { status: string }) {
  if (status === 'AVAILABLE')
    return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  if (status === 'DEGRADED')
    return <AlertTriangle className="h-5 w-5 text-yellow-400" />;
  return <XCircle className="h-5 w-5 text-red-400" />;
}

// ── Provider card ─────────────────────────────────────────────
function ProviderCard({ records }: { records: ProviderHealthRecord[] }) {
  if (!records.length) return null;
  const provider = records[0].model.provider;
  const allAvailable = records.every((r) => r.status === 'AVAILABLE');
  const anyDown = records.some((r) => r.status === 'UNAVAILABLE');
  const overallStatus = anyDown ? 'UNAVAILABLE' : allAvailable ? 'AVAILABLE' : 'DEGRADED';

  const avgLatency =
    records.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0) / records.length;

  const providerColors: Record<string, string> = {
    OPENAI: 'from-green-900/30 to-slate-900',
    ANTHROPIC: 'from-orange-900/30 to-slate-900',
    GOOGLE: 'from-blue-900/30 to-slate-900',
    OLLAMA: 'from-purple-900/30 to-slate-900',
  };

  return (
    <div
      className={`rounded-xl border border-slate-800 bg-gradient-to-br ${providerColors[provider] ?? 'from-slate-800 to-slate-900'} p-5`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{provider}</p>
          <div className="mt-1 flex items-center gap-2">
            <StatusIcon status={overallStatus} />
            <Badge
              variant={
                overallStatus === 'AVAILABLE'
                  ? 'success'
                  : overallStatus === 'DEGRADED'
                    ? 'warning'
                    : 'danger'
              }
            >
              {overallStatus.toLowerCase()}
            </Badge>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Avg latency</p>
          <p className="text-lg font-bold tabular-nums text-white">{formatLatency(avgLatency)}</p>
        </div>
      </div>

      {/* Models */}
      <div className="mt-4 space-y-2">
        {records.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <div
                className={`h-1.5 w-1.5 rounded-full ${
                  r.status === 'AVAILABLE'
                    ? 'bg-emerald-400'
                    : r.status === 'DEGRADED'
                      ? 'bg-yellow-400'
                      : 'bg-red-400'
                }`}
              />
              <span className="text-xs font-medium text-slate-300">{r.model.modelId}</span>
            </div>
            <div className="flex items-center gap-3 text-right">
              <span className="text-xs text-slate-500">
                {r.latencyMs ? formatLatency(r.latencyMs) : '—'}
              </span>
              <span className="text-xs text-slate-600">{relativeTime(r.checkedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Latency radar ─────────────────────────────────────────────
function LatencyRadar({ healthData }: { healthData: ProviderHealthRecord[] }) {
  const byProvider = healthData.reduce<Record<string, number[]>>((acc, r) => {
    acc[r.model.provider] = acc[r.model.provider] ?? [];
    acc[r.model.provider].push(r.latencyMs ?? 0);
    return acc;
  }, {});

  const data = Object.entries(byProvider).map(([provider, latencies]) => ({
    provider,
    latency: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
        <PolarGrid stroke="#1e293b" />
        <PolarAngleAxis dataKey="provider" tick={{ fill: '#64748b', fontSize: 11 }} />
        <Radar
          name="Latency (ms)"
          dataKey="latency"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.25}
        />
        <Tooltip
          formatter={(v: number) => [formatLatency(v), 'Avg Latency']}
          contentStyle={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function ProvidersPage() {
  const { canAdmin } = useWorkspaceRole();
  const health = useApi(useCallback((t) => workspaceApi.health(t), []));
  const infra = useApi(
    useCallback((t) => infraHealthApi.health(t), []),
  );

  // Group by provider
  const byProvider = (health.data ?? []).reduce<Record<string, ProviderHealthRecord[]>>(
    (acc, r) => {
      const p = r.model.provider;
      acc[p] = acc[p] ?? [];
      acc[p].push(r);
      return acc;
    },
    {},
  );

  const totalModels = health.data?.length ?? 0;
  const availableModels = health.data?.filter((r) => r.status === 'AVAILABLE').length ?? 0;
  const degradedModels = health.data?.filter((r) => r.status === 'DEGRADED').length ?? 0;
  const downModels = health.data?.filter((r) => r.status === 'UNAVAILABLE').length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Provider Monitoring</h1>
          <p className="mt-0.5 text-sm text-slate-400">Real-time health status · checked every 2 minutes</p>
        </div>
        <button
          onClick={health.refetch}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white"
        >
          <RefreshCcw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Models', value: totalModels, icon: Activity, color: 'text-blue-400' },
          { label: 'Available', value: availableModels, icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Degraded', value: degradedModels, icon: AlertTriangle, color: 'text-yellow-400' },
          { label: 'Down', value: downModels, icon: XCircle, color: 'text-red-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4"
          >
            <Icon className={`h-5 w-5 ${color}`} />
            <div>
              <p className="text-xl font-bold text-white">{value}</p>
              <p className="text-xs text-slate-400">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Loading */}
      {health.loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      )}

      {/* No data */}
      {!health.loading && !health.data?.length && (
        <EmptyState
          icon={<Wifi className="h-6 w-6" />}
          title="No health data yet"
          description="Health checks run every 2 minutes via BullMQ workers. Make sure the API server is running."
        />
      )}

      {/* Provider cards + radar */}
      {!health.loading && health.data && health.data.length > 0 && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Provider cards */}
          <div className="space-y-4 xl:col-span-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Object.entries(byProvider).map(([provider, records]) => (
                <ProviderCard key={provider} records={records} />
              ))}
            </div>
          </div>

          {/* Radar chart */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-400" />
                  <CardTitle>Latency by Provider</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <LatencyRadar healthData={health.data} />
              </CardContent>
            </Card>

            {/* Model registry info */}
            <Card>
              <CardHeader>
                <CardTitle>Circuit Breakers</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400">
                  Circuit breakers protect against cascading failures. State is stored in Redis and
                  transitions automatically.
                </p>
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-emerald-400" />
                      <span className="text-slate-400">CLOSED</span>
                    </div>
                    <span className="text-slate-500">Normal operation</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-red-400" />
                      <span className="text-slate-400">OPEN</span>
                    </div>
                    <span className="text-slate-500">Blocking requests · 60s timeout</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-yellow-400" />
                      <span className="text-slate-400">HALF-OPEN</span>
                    </div>
                    <span className="text-slate-500">Probe requests allowed</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {canAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Platform Services</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-slate-400">
              Infrastructure health snapshots (database, Redis, API) — recorded every 2 minutes.
            </p>
            {infra.loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            ) : !infra.data?.length ? (
              <p className="text-sm text-slate-500">No infrastructure health data yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {infra.data.map((check) => (
                  <div
                    key={check.service}
                    className="rounded-lg border border-slate-800 bg-slate-900/50 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize text-white">{check.service}</span>
                      <Badge variant={check.status === 'healthy' ? 'success' : 'danger'}>
                        {check.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {check.latencyMs != null ? formatLatency(check.latencyMs) : '—'} ·{' '}
                      {relativeTime(check.checkedAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
