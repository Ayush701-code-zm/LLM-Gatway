'use client';

import { Activity, DollarSign, TrendingDown, Zap, Clock, CheckCircle2, AlertTriangle, RefreshCcw } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { analyticsApi, workspaceApi } from '@/lib/api';
import { StatCard } from '@/components/ui/stat-card';
import { StatCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SpendChart } from '@/components/dashboard/SpendChart';
import { CacheDonut } from '@/components/dashboard/CacheDonut';
import { RequestVolumeChart } from '@/components/dashboard/RequestVolumeChart';
import { LatencyChart } from '@/components/dashboard/LatencyChart';
import { BudgetProgress } from '@/components/dashboard/BudgetProgress';
import { RateLimitCard } from '@/components/dashboard/RateLimitCard';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatLatency, formatNumber, relativeTime } from '@/lib/utils';

export default function DashboardPage() {
  const overview = useApi((token) => analyticsApi.overview(token));
  const daily = useApi((token) => analyticsApi.dailySpend(token, 30));
  const health = useApi((token) => workspaceApi.health(token));
  const budgets = useApi((token) => workspaceApi.budgets(token));
  const rateLimits = useApi((token) => workspaceApi.rateLimits(token));

  const stats = overview.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-400">Last 30 days · all providers</p>
        </div>
        <button
          onClick={() => { overview.refetch(); daily.refetch(); health.refetch(); budgets.refetch(); rateLimits.refetch(); }}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
        >
          <RefreshCcw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Primary stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {overview.loading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              title="Total Requests"
              value={stats ? formatNumber(stats.totalRequests) : '—'}
              icon={<Activity className="h-4 w-4" />}
              iconBg="bg-blue-900/50 text-blue-400"
            />
            <StatCard
              title="Total Spend"
              value={stats ? formatCurrency(stats.totalCostUsd, 2) : '—'}
              subValue="actual cost"
              icon={<DollarSign className="h-4 w-4" />}
              iconBg="bg-slate-800 text-slate-400"
            />
            <StatCard
              title="Money Saved"
              value={stats ? formatCurrency(stats.totalSavingsUsd, 2) : '—'}
              subValue={stats ? `${stats.savingsPercent}% savings rate` : ''}
              icon={<TrendingDown className="h-4 w-4" />}
              iconBg="bg-emerald-900/50 text-emerald-400"
            />
            <StatCard
              title="Cache Hit Rate"
              value={stats ? `${stats.cacheHitRate}%` : '—'}
              subValue={stats ? `${formatNumber(stats.cacheHits)} hits` : ''}
              icon={<Zap className="h-4 w-4" />}
              iconBg="bg-yellow-900/50 text-yellow-400"
            />
          </>
        )}
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-4">
        {overview.loading ? (
          Array.from({ length: 3 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              title="Avg Latency"
              value={stats ? formatLatency(stats.avgLatencyMs) : '—'}
              icon={<Clock className="h-4 w-4" />}
              iconBg="bg-slate-800 text-slate-400"
            />
            <StatCard
              title="Success Rate"
              value={stats ? `${stats.successRate}%` : '—'}
              icon={<CheckCircle2 className="h-4 w-4" />}
              iconBg="bg-emerald-900/50 text-emerald-400"
            />
            <StatCard
              title="Fallback Rate"
              value={stats ? `${stats.fallbackRate}%` : '—'}
              subValue={stats ? `${stats.retryRate}% retry rate` : ''}
              icon={<AlertTriangle className="h-4 w-4" />}
              iconBg="bg-orange-900/50 text-orange-400"
            />
          </>
        )}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Spend over time — full width */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Cost vs Savings (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {daily.loading ? (
              <div className="flex h-60 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : daily.data ? (
              <SpendChart data={daily.data} />
            ) : (
              <p className="py-16 text-center text-sm text-slate-500">No spend data available yet</p>
            )}
          </CardContent>
        </Card>

        {/* Cache donut */}
        <Card>
          <CardHeader>
            <CardTitle>Semantic Cache</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {overview.loading ? (
              <div className="flex h-40 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
              </div>
            ) : stats ? (
              <>
                <CacheDonut hits={stats.cacheHits} misses={stats.cacheMisses} />
                <div className="mt-4 w-full space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-yellow-400" />
                      <span className="text-slate-400">Cache hits</span>
                    </div>
                    <span className="font-medium text-white">{formatNumber(stats.cacheHits)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-slate-700" />
                      <span className="text-slate-400">Cache misses</span>
                    </div>
                    <span className="font-medium text-white">{formatNumber(stats.cacheMisses)}</span>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Request volume */}
        <Card>
          <CardHeader>
            <CardTitle>Request Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {daily.loading ? (
              <div className="flex h-48 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : daily.data ? (
              <RequestVolumeChart data={daily.data} />
            ) : (
              <p className="py-12 text-center text-sm text-slate-500">No data available</p>
            )}
          </CardContent>
        </Card>

        {/* Avg latency */}
        <Card>
          <CardHeader>
            <CardTitle>Average Latency</CardTitle>
          </CardHeader>
          <CardContent>
            {daily.loading ? (
              <div className="flex h-48 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
              </div>
            ) : daily.data ? (
              <LatencyChart data={daily.data} />
            ) : (
              <p className="py-12 text-center text-sm text-slate-500">No data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Provider health + Budget + Rate limits */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Provider health */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Provider Health</CardTitle>
              <span className="text-xs text-slate-500">Updated every 2m</span>
            </div>
          </CardHeader>
          <CardContent>
            {health.loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-slate-700" />
                      <div className="h-4 w-32 animate-pulse rounded bg-slate-800" />
                    </div>
                    <div className="h-4 w-16 animate-pulse rounded bg-slate-800" />
                  </div>
                ))}
              </div>
            ) : health.data?.length ? (
              <div className="space-y-3">
                {health.data.map((h) => (
                  <div key={h.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          h.status === 'AVAILABLE'
                            ? 'bg-emerald-400'
                            : h.status === 'DEGRADED'
                              ? 'bg-yellow-400'
                              : 'bg-red-400'
                        }`}
                      />
                      <span className="text-sm text-slate-300">
                        {h.model.provider} / {h.model.modelId}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">
                        {h.latencyMs ? formatLatency(h.latencyMs) : '—'}
                      </span>
                      <Badge
                        variant={
                          h.status === 'AVAILABLE'
                            ? 'success'
                            : h.status === 'DEGRADED'
                              ? 'warning'
                              : 'danger'
                        }
                      >
                        {h.status.toLowerCase()}
                      </Badge>
                      <span className="text-xs text-slate-600">{relativeTime(h.checkedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">
                No health data yet — health checks run every 2 minutes
              </p>
            )}
          </CardContent>
        </Card>

        {/* Budget */}
        <Card>
          <CardHeader>
            <CardTitle>Budget Usage</CardTitle>
          </CardHeader>
          <CardContent>
            {budgets.loading ? (
              <div className="space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i}>
                    <div className="mb-1 flex justify-between">
                      <div className="h-4 w-24 animate-pulse rounded bg-slate-800" />
                      <div className="h-4 w-20 animate-pulse rounded bg-slate-800" />
                    </div>
                    <div className="h-2 w-full animate-pulse rounded-full bg-slate-800" />
                  </div>
                ))}
              </div>
            ) : (
              <BudgetProgress budgets={budgets.data ?? []} />
            )}
          </CardContent>
        </Card>

        {/* Rate limits */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Rate Limits</CardTitle>
              <span className="text-xs text-slate-500">Live from Redis</span>
            </div>
          </CardHeader>
          <CardContent>
            {rateLimits.loading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i}>
                    <div className="mb-1 h-3 w-24 animate-pulse rounded bg-slate-800" />
                    <div className="h-2 w-full animate-pulse rounded-full bg-slate-800" />
                  </div>
                ))}
              </div>
            ) : rateLimits.data ? (
              <RateLimitCard status={rateLimits.data} />
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">Unable to load rate limit status</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
