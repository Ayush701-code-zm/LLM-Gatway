'use client';

import type { RateLimitStatus } from '@/lib/api';

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function barColor(p: number): string {
  if (p >= 90) return 'bg-red-500';
  if (p >= 70) return 'bg-yellow-500';
  return 'bg-blue-500';
}

function LimitBar({ label, used = 0, limit = 0, resetLabel }: {
  label: string;
  used?: number;
  limit?: number;
  resetLabel: string;
}) {
  const safeUsed = used ?? 0;
  const safeLimit = limit ?? 0;
  const p = pct(safeUsed, safeLimit);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">
          {safeUsed.toLocaleString()} / {safeLimit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full transition-all ${barColor(p)}`} style={{ width: `${p}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-slate-600">{resetLabel}</p>
    </div>
  );
}

export function RateLimitCard({ status }: { status: RateLimitStatus }) {
  const resetRpm = status.resetRpm ?? 0;
  const resetRpd = status.resetRpd ?? 0;
  const rpmReset = new Date(resetRpm * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const rpdReset = new Date(resetRpd * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-4">
      <LimitBar
        label="Requests / minute"
        used={status.usedRpm}
        limit={status.limitRpm}
        resetLabel={`Resets at ${rpmReset}`}
      />
      <LimitBar
        label="Requests / day"
        used={status.usedRpd}
        limit={status.limitRpd}
        resetLabel={`Resets ${rpdReset}`}
      />
      <LimitBar
        label="Tokens / minute"
        used={status.usedTpm}
        limit={status.limitTpm}
        resetLabel={`Resets at ${rpmReset}`}
      />
    </div>
  );
}
