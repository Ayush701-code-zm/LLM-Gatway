'use client';

import { useCallback } from 'react';
import { useApi } from '@/hooks/useApi';
import { analyticsApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SpendChart } from '@/components/dashboard/SpendChart';
import { formatCurrency } from '@/lib/utils';
import { DollarSign, TrendingDown, Zap, BarChart3 } from 'lucide-react';

export default function CostExplorerPage() {
  const daily = useApi(useCallback((t) => analyticsApi.dailySpend(t, 30), []));
  const overview = useApi(useCallback((t) => analyticsApi.overview(t), []));

  const totalBaseline = daily.data?.reduce((s, d) => s + d.baselineCostUsd, 0) ?? 0;
  const totalActual = daily.data?.reduce((s, d) => s + d.actualCostUsd, 0) ?? 0;
  const totalSavings = daily.data?.reduce((s, d) => s + d.totalSavingsUsd, 0) ?? 0;
  const cacheSavings = daily.data?.reduce((s, d) => s + d.cacheSavingsUsd, 0) ?? 0;
  const routingSavings = daily.data?.reduce((s, d) => s + d.routingSavingsUsd, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Cost Explorer</h1>
        <p className="mt-0.5 text-sm text-slate-400">Where your money goes — and where it doesn't</p>
      </div>

      {/* Savings breakdown */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Baseline Cost', value: formatCurrency(totalBaseline, 2), description: 'If using GPT-4o for everything', icon: BarChart3, color: 'text-slate-400', bg: 'bg-slate-800' },
          { label: 'Actual Cost', value: formatCurrency(totalActual, 2), description: 'With smart routing', icon: DollarSign, color: 'text-blue-400', bg: 'bg-blue-900/50' },
          { label: 'Total Savings', value: formatCurrency(totalSavings, 2), description: 'Routing + cache combined', icon: TrendingDown, color: 'text-emerald-400', bg: 'bg-emerald-900/50' },
          { label: 'Cache Savings', value: formatCurrency(cacheSavings, 2), description: 'From semantic cache hits', icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-900/50' },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">{item.label}</p>
              <div className={`rounded-lg p-2 ${item.bg}`}>
                <item.icon className={`h-4 w-4 ${item.color}`} />
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold tabular-nums text-white">{item.value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
          </div>
        ))}
      </div>

      {/* Savings visualization */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Cost Comparison (30 days)</CardTitle>
            {totalBaseline > 0 && (
              <div className="rounded-full bg-emerald-900/50 px-3 py-1 text-sm font-semibold text-emerald-300">
                {((totalSavings / totalBaseline) * 100).toFixed(1)}% saved
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {daily.loading ? (
            <div className="flex h-60 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : daily.data ? (
            <SpendChart data={daily.data} />
          ) : (
            <p className="py-16 text-center text-sm text-slate-500">No spend data yet — start making requests to see savings</p>
          )}
        </CardContent>
      </Card>

      {/* Savings by type */}
      {totalSavings > 0 && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Savings Breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: 'Smart Routing Savings', value: routingSavings, pct: totalSavings > 0 ? (routingSavings / totalSavings) * 100 : 0, color: 'bg-blue-500' },
                { label: 'Semantic Cache Savings', value: cacheSavings, pct: totalSavings > 0 ? (cacheSavings / totalSavings) * 100 : 0, color: 'bg-yellow-500' },
              ].map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate-400">{item.label}</span>
                    <span className="font-medium text-white">{formatCurrency(item.value, 2)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>How SmartRoute saves money</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-400">
              <p>
                <span className="font-medium text-white">Smart Routing</span> classifies your prompt as SIMPLE, MEDIUM, or COMPLEX and routes to the cheapest model that meets the quality bar.
              </p>
              <p>
                <span className="font-medium text-white">Semantic Cache</span> generates embeddings for every prompt and checks for similar past requests. If similarity ≥ 92%, it returns the cached response — zero provider cost.
              </p>
              <p className="text-xs text-slate-600">
                Baseline = cost of routing all traffic to GPT-4o (the most expensive eligible model).
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
