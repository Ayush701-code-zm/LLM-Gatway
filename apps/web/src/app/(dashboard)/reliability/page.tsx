'use client';

import { useCallback } from 'react';
import { Shield, RefreshCcw, AlertTriangle, Zap, Activity } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { analyticsApi } from '@/lib/api';
import { StatCard } from '@/components/ui/stat-card';
import { StatCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/utils';

export default function ReliabilityPage() {
  const reliability = useApi(useCallback((t) => analyticsApi.reliability(t, 30), []));
  const r = reliability.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Reliability</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Fallback routing, retries, and circuit breaker activity · last 30 days
          </p>
        </div>
        <button
          onClick={reliability.refetch}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white"
        >
          <RefreshCcw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {reliability.loading ? (
          Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              title="Fallback Rate"
              value={r ? `${r.fallbackRate}%` : '—'}
              subValue={r ? `${r.fallbackCount} events` : ''}
              icon={<Shield className="h-4 w-4" />}
              iconBg="bg-orange-900/50 text-orange-400"
            />
            <StatCard
              title="Retry Rate"
              value={r ? `${r.retryRate}%` : '—'}
              subValue={r ? `${r.retryCount} requests` : ''}
              icon={<RefreshCcw className="h-4 w-4" />}
              iconBg="bg-yellow-900/50 text-yellow-400"
            />
            <StatCard
              title="Error Rate"
              value={r ? `${r.errorRate}%` : '—'}
              subValue={r ? `${r.failedCount} failed` : ''}
              icon={<AlertTriangle className="h-4 w-4" />}
              iconBg="bg-red-900/50 text-red-400"
            />
            <StatCard
              title="Circuit Opens"
              value={r ? r.circuitBreakerOpens.toString() : '—'}
              subValue="provider breakers"
              icon={<Zap className="h-4 w-4" />}
              iconBg="bg-purple-900/50 text-purple-400"
            />
            <StatCard
              title="Total Requests"
              value={r ? r.totalRequests.toLocaleString() : '—'}
              icon={<Activity className="h-4 w-4" />}
              iconBg="bg-blue-900/50 text-blue-400"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Fallback routes */}
        <Card>
          <CardHeader><CardTitle>Fallback Routes</CardTitle></CardHeader>
          <CardContent>
            {reliability.loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : r?.fallbackByProvider.length ? (
              <div className="space-y-2">
                {r.fallbackByProvider.map((row) => (
                  <div
                    key={`${row.failedProvider}-${row.fallbackProvider}`}
                    className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2"
                  >
                    <span className="text-sm text-slate-300">
                      {row.failedProvider} → {row.fallbackProvider}
                    </span>
                    <Badge variant="warning">{row.count}×</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">No fallback events in this period</p>
            )}
          </CardContent>
        </Card>

        {/* Recent circuit breaker events */}
        <Card>
          <CardHeader><CardTitle>Circuit Breaker Events</CardTitle></CardHeader>
          <CardContent>
            {reliability.loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : r?.recentCircuitEvents.length ? (
              <div className="space-y-2">
                {r.recentCircuitEvents.map((ev) => (
                  <div key={ev.id} className="rounded-lg bg-slate-800/50 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">
                        {ev.provider} / {ev.modelId}
                      </span>
                      <Badge variant={ev.toState === 'OPEN' ? 'danger' : 'success'}>
                        {ev.fromState} → {ev.toState}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{ev.reason}</p>
                    <p className="mt-1 text-xs text-slate-600">{relativeTime(ev.createdAt)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">No circuit breaker events</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent fallbacks */}
      <Card>
        <CardHeader><CardTitle>Recent Fallback Events</CardTitle></CardHeader>
        <CardContent>
          {reliability.loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : r?.recentFallbacks.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                    <th className="pb-2 pr-4">Failed</th>
                    <th className="pb-2 pr-4">Fallback</th>
                    <th className="pb-2 pr-4">Reason</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {r.recentFallbacks.map((ev) => (
                    <tr key={ev.id}>
                      <td className="py-2 pr-4 text-slate-300">
                        {ev.failedProvider}/{ev.failedModelId}
                      </td>
                      <td className="py-2 pr-4 text-slate-300">
                        {ev.fallbackProvider}/{ev.fallbackModelId}
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-500 max-w-[200px] truncate">
                        {ev.failureReason}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={ev.success ? 'success' : 'danger'}>
                          {ev.success ? 'recovered' : 'failed'}
                        </Badge>
                      </td>
                      <td className="py-2 text-xs text-slate-500">{relativeTime(ev.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">No fallback events yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
