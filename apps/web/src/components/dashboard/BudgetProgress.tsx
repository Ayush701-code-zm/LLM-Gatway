import type { Budget } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

function BudgetBar({ budget }: { budget: Budget }) {
  const pct = Math.min((budget.currentSpend / budget.limitUsd) * 100, 100);
  const color =
    pct >= 100 ? 'bg-red-500' : pct >= 90 ? 'bg-orange-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-blue-500';
  const textColor =
    pct >= 100 ? 'text-red-400' : pct >= 90 ? 'text-orange-400' : pct >= 80 ? 'text-yellow-400' : 'text-slate-400';

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <div>
          <span className="font-medium text-white">{budget.name}</span>
          <span className="ml-2 text-xs text-slate-500">{budget.period}</span>
        </div>
        <div className="text-right">
          <span className="font-medium text-white">{formatCurrency(budget.currentSpend, 2)}</span>
          <span className="text-slate-500"> / {formatCurrency(budget.limitUsd, 0)}</span>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={cn('mt-0.5 text-right text-xs', textColor)}>
        {pct.toFixed(1)}% used · {formatCurrency(budget.limitUsd - budget.currentSpend, 2)} remaining
      </p>
    </div>
  );
}

export function BudgetProgress({ budgets }: { budgets: Budget[] }) {
  if (!budgets.length) {
    return <p className="py-4 text-center text-sm text-slate-500">No active budgets</p>;
  }
  return (
    <div className="space-y-5">
      {budgets.map((b) => (
        <BudgetBar key={b.id} budget={b} />
      ))}
    </div>
  );
}
