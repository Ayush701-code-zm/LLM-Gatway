'use client';

import { useCallback } from 'react';
import { useApi } from '@/hooks/useApi';
import { analyticsApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SpendChart } from '@/components/dashboard/SpendChart';
import { RequestVolumeChart } from '@/components/dashboard/RequestVolumeChart';
import { LatencyChart } from '@/components/dashboard/LatencyChart';
import { UsageMetricsChart } from '@/components/dashboard/UsageMetricsChart';
import { StatCard } from '@/components/ui/stat-card';
import { StatCardSkeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatNumber, formatPercent, formatLatency } from '@/lib/utils';
import { BarChart3, DollarSign, TrendingDown, Zap, Clock } from 'lucide-react';

export default function AnalyticsPage() {
  const overview = useApi(useCallback((t) => analyticsApi.overview(t), []));
  const daily30 = useApi(useCallback((t) => analyticsApi.dailySpend(t, 30), []));
  const daily7 = useApi(useCallback((t) => analyticsApi.dailySpend(t, 7), []));
  const usage = useApi(useCallback((t) => analyticsApi.usage(t, 30), []));

  const s = overview.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="mt-0.5 text-sm text-slate-400">Detailed cost and performance breakdown</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {overview.loading
          ? Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
          : [
              { title: 'Total Requests', value: s ? formatNumber(s.totalRequests) : '—', icon: <BarChart3 className="h-4 w-4" />, bg: 'bg-blue-900/50 text-blue-400' },
              { title: 'Total Spend', value: s ? formatCurrency(s.totalCostUsd, 2) : '—', icon: <DollarSign className="h-4 w-4" />, bg: 'bg-slate-800 text-slate-400' },
              { title: 'Savings', value: s ? formatCurrency(s.totalSavingsUsd, 2) : '—', icon: <TrendingDown className="h-4 w-4" />, bg: 'bg-emerald-900/50 text-emerald-400' },
              { title: 'Cache Hit Rate', value: s ? formatPercent(Number(s.cacheHitRate)) : '—', icon: <Zap className="h-4 w-4" />, bg: 'bg-yellow-900/50 text-yellow-400' },
              { title: 'Avg Latency', value: s ? formatLatency(s.avgLatencyMs) : '—', icon: <Clock className="h-4 w-4" />, bg: 'bg-slate-800 text-slate-400' },
            ].map((c) => (
              <StatCard key={c.title} title={c.title} value={c.value} icon={c.icon} iconBg={c.bg} />
            ))}
      </div>

      {/* 30-day spend */}
      <Card>
        <CardHeader>
          <CardTitle>Cost vs Savings — Last 30 Days</CardTitle>
        </CardHeader>
        <CardContent>
          {daily30.loading ? (
            <div className="flex h-60 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : daily30.data ? (
            <SpendChart data={daily30.data} />
          ) : (
            <p className="py-16 text-center text-sm text-slate-500">No data yet</p>
          )}
        </CardContent>
      </Card>

      {/* Usage metrics from time-series store */}
      <Card>
        <CardHeader>
          <CardTitle>Usage Metrics — Last 30 Days</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.loading ? (
            <div className="flex h-56 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            </div>
          ) : usage.data?.series.length ? (
            <UsageMetricsChart data={usage.data.series} />
          ) : (
            <p className="py-16 text-center text-sm text-slate-500">
              No usage metrics yet — data is recorded as requests complete
            </p>
          )}
        </CardContent>
      </Card>

      {/* 7-day breakdown */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Request Volume — Last 7 Days</CardTitle></CardHeader>
          <CardContent>
            {daily7.loading ? (
              <div className="flex h-48 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>
            ) : daily7.data ? (
              <RequestVolumeChart data={daily7.data} />
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Latency Trend — Last 7 Days</CardTitle></CardHeader>
          <CardContent>
            {daily7.loading ? (
              <div className="flex h-48 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" /></div>
            ) : daily7.data ? (
              <LatencyChart data={daily7.data} />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
