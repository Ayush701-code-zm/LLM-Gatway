'use client';

import { useCallback } from 'react';
import { AlertTriangle, Bell } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { analyticsApi } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { relativeTime } from '@/lib/utils';

export default function AnomaliesPage() {
  const anomalies = useApi(useCallback((t) => analyticsApi.anomalies(t, 30), []));

  const items = anomalies.data?.anomalies ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Anomalies</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Cost spikes, volume surges, latency spikes, and error surges detected in the last 30 days
        </p>
      </div>

      <Card className="overflow-hidden">
        {anomalies.loading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Bell className="h-8 w-8" />}
            title="No anomalies detected"
            description="When the anomaly engine flags unusual traffic patterns, they will appear here and in Notifications."
          />
        ) : (
          <div>
            {items.map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-4 border-b border-slate-800/50 px-5 py-4 last:border-0"
              >
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-yellow-900/40 text-yellow-400">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">{a.title}</span>
                    <Badge variant="warning">anomaly detected</Badge>
                    {!a.readAt && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" title="Unread" />}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{a.body}</p>
                  <p className="mt-1.5 text-xs text-slate-600">{relativeTime(a.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
