'use client';

import { useCallback } from 'react';
import { useApi } from '@/hooks/useApi';
import { analyticsApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CacheDonut } from '@/components/dashboard/CacheDonut';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import { Zap, DollarSign, Database } from 'lucide-react';

export default function CachePage() {
  const overview = useApi(useCallback((t) => analyticsApi.overview(t), []));

  const s = overview.data;
  const cacheHits = s?.cacheHits ?? 0;
  const cacheMisses = s?.cacheMisses ?? 0;
  const hitRatePct = s ? Number(s.cacheHitRate) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Semantic Cache</h1>
        <p className="mt-0.5 text-sm text-slate-400">pgvector-powered similarity caching</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Cache Hit Rate', value: s ? `${s.cacheHitRate}%` : '—', sub: 'Threshold: 92% similarity', icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-900/50' },
          { label: 'Total Cache Hits', value: s ? formatNumber(cacheHits) : '—', sub: `${formatNumber(cacheMisses)} misses`, icon: Database, color: 'text-blue-400', bg: 'bg-blue-900/50' },
          { label: 'Est. Cache Savings', value: s ? formatCurrency(s.cacheSavingsUsd, 2) : '—', sub: 'Requests served from cache', icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-900/50' },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">{item.label}</p>
              <div className={`rounded-lg p-2 ${item.bg}`}>
                <item.icon className={`h-4 w-4 ${item.color}`} />
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-white">{item.value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{item.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cache Distribution</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <CacheDonut hits={cacheHits} misses={cacheMisses} />
            <div className="w-full space-y-2">
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-yellow-400" />
                  <span className="text-slate-400">Cache hits</span>
                </div>
                <span className="font-medium text-white">{formatNumber(cacheHits)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-slate-700" />
                  <span className="text-slate-400">Cache misses</span>
                </div>
                <span className="font-medium text-white">{formatNumber(cacheMisses)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>How Semantic Cache Works</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {[
              { step: '1', title: 'Embedding generation', desc: 'Incoming prompt is vectorized using OpenAI text-embedding-3-small.' },
              { step: '2', title: 'Vector similarity search', desc: 'pgvector computes cosine distance against stored embeddings in O(log n).' },
              { step: '3', title: 'Threshold check', desc: 'If cosine similarity ≥ 0.92, the cached response is returned immediately.' },
              { step: '4', title: 'Cache store', desc: 'On a miss, the response + embedding are stored in PostgreSQL for future hits.' },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-3">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-900/50 text-xs font-bold text-blue-400">
                  {item.step}
                </div>
                <div>
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="text-xs text-slate-500">{item.desc}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
