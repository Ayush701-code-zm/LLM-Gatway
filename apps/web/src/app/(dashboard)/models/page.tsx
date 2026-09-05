'use client';

import { useCallback, useState } from 'react';
import { Cpu, Loader2, Power, PowerOff, RefreshCcw } from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import { modelsApi, type ModelRecord } from '@/lib/api';
import { selectCurrentWorkspace, useAuthStore } from '@/store/auth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/utils';

export default function ModelsPage() {
  const currentRole = useAuthStore((s) => selectCurrentWorkspace(s)?.role ?? 'MEMBER');
  const canAdmin = ['OWNER', 'ADMIN'].includes(currentRole);

  const models = useApi(useCallback((_t) => modelsApi.list(), []));
  const { mutate: toggleModel, loading: toggling } = useMutation(
    (t, input: { id: string; enable: boolean }) =>
      input.enable ? modelsApi.enable(t, input.id) : modelsApi.disable(t, input.id),
  );

  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleToggle(model: ModelRecord) {
    setBusyId(model.id);
    await toggleModel({ id: model.id, enable: !model.isEnabled });
    models.refetch();
    setBusyId(null);
  }

  const grouped = (models.data ?? []).reduce<Record<string, ModelRecord[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Model Registry</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {models.data?.length ?? '…'} models · routing engine uses this table
          </p>
        </div>
        <button
          onClick={models.refetch}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white"
        >
          <RefreshCcw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {!canAdmin && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-sm text-slate-400">
          Read-only view. Admins can enable or disable models for routing.
        </div>
      )}

      {models.loading ? (
        <Card>
          <div className="p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRowSkeleton key={i} cols={6} />
            ))}
          </div>
        </Card>
      ) : !models.data?.length ? (
        <EmptyState
          icon={<Cpu className="h-8 w-8" />}
          title="No models registered"
          description="Run db:seed to populate the model registry"
        />
      ) : (
        Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([provider, providerModels]) => (
            <Card key={provider}>
              <div className="border-b border-slate-800 px-4 py-3">
                <h2 className="font-semibold text-white">{provider}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                      <th className="px-4 py-3">Model</th>
                      <th className="px-4 py-3">Tier</th>
                      <th className="px-4 py-3">Input $/M</th>
                      <th className="px-4 py-3">Output $/M</th>
                      <th className="px-4 py-3">Context</th>
                      <th className="px-4 py-3">Status</th>
                      {canAdmin && <th className="px-4 py-3">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {providerModels.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-800/30">
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">{m.displayName}</p>
                          <p className="font-mono text-xs text-slate-500">{m.modelId}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="muted">{m.qualityTier.toLowerCase()}</Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {formatCurrency(m.inputCostPerMillion, 2)}
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {formatCurrency(m.outputCostPerMillion, 2)}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {(m.contextWindow / 1000).toFixed(0)}K
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={m.isEnabled ? 'success' : 'danger'}>
                            {m.isEnabled ? m.availabilityStatus.toLowerCase() : 'disabled'}
                          </Badge>
                        </td>
                        {canAdmin && (
                          <td className="px-4 py-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={toggling && busyId === m.id}
                              onClick={() => handleToggle(m)}
                            >
                              {busyId === m.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : m.isEnabled ? (
                                <><PowerOff className="h-3.5 w-3.5" /> Disable</>
                              ) : (
                                <><Power className="h-3.5 w-3.5" /> Enable</>
                              )}
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
      )}
    </div>
  );
}
