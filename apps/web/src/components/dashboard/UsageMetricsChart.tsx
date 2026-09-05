'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { UsageMetricsDay } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export function UsageMetricsChart({ data }: { data: UsageMetricsDay[] }) {
  const chartData = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Requests: d.requests,
    Cost: d.costUsd,
    Latency: d.avgLatencyMs,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: '#64748b', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="left"
          tick={{ fill: '#64748b', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fill: '#64748b', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v) => formatCurrency(v, 2)}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
          labelStyle={{ color: '#94a3b8' }}
          formatter={(value: number, name: string) => {
            if (name === 'Cost') return [formatCurrency(value, 4), name];
            if (name === 'Latency') return [`${value} ms`, name];
            return [value.toLocaleString(), name];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
        <Bar yAxisId="left" dataKey="Requests" fill="#3b82f6" barSize={8} radius={[2, 2, 0, 0]} />
        <Line yAxisId="right" type="monotone" dataKey="Cost" stroke="#10b981" strokeWidth={2} dot={false} />
        <Line yAxisId="left" type="monotone" dataKey="Latency" stroke="#a855f7" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
