import { cn } from '@/lib/utils';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  trend?: { value: string; direction: 'up' | 'down'; positive?: boolean };
  icon: React.ReactNode;
  iconBg?: string;
  className?: string;
}

export function StatCard({ title, value, subValue, trend, icon, iconBg, className }: StatCardProps) {
  const trendPositive =
    trend?.positive !== undefined ? trend.positive : trend?.direction === 'up';

  return (
    <div className={cn('rounded-xl border border-slate-800 bg-slate-900 p-5', className)}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-400">{title}</p>
        <div className={cn('rounded-lg p-2', iconBg ?? 'bg-slate-800 text-slate-400')}>
          {icon}
        </div>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums text-white">{value}</p>
      {subValue && <p className="mt-0.5 text-xs text-slate-500">{subValue}</p>}
      {trend && (
        <div
          className={cn(
            'mt-2 flex items-center gap-1 text-xs font-medium',
            trendPositive ? 'text-emerald-400' : 'text-red-400',
          )}
        >
          {trend.direction === 'up' ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {trend.value} vs last month
        </div>
      )}
    </div>
  );
}
