'use client';

import { useCallback, useState } from 'react';
import { Loader2, Shield, Users, Building2, Activity } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { adminApi, type AdminUser, type AdminWorkspace } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function AdminPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [tab, setTab] = useState<'workspaces' | 'users'>('workspaces');

  const overview = useApi(useCallback((t) => adminApi.overview(t), []));
  const workspaces = useApi(useCallback((t) => adminApi.workspaces(t, 1), []));
  const users = useApi(useCallback((t) => adminApi.users(t, 1), []));

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div
        data-testid="admin-access-denied"
        className="rounded-lg border border-red-800/50 bg-red-900/20 p-6 text-center text-red-400"
      >
        Super-admin access required.
      </div>
    );
  }

  async function toggleWorkspacePlan(ws: AdminWorkspace) {
    if (!accessToken) return;
    const nextPlan = ws.plan === 'FREE' ? 'PRO' : ws.plan === 'PRO' ? 'ENTERPRISE' : 'FREE';
    await adminApi.updateWorkspace(accessToken, ws.id, { plan: nextPlan });
    workspaces.refetch();
  }

  async function toggleUserRole(u: AdminUser) {
    if (!accessToken || u.id === user?.id) return;
    const nextRole = u.role === 'SUPER_ADMIN' ? 'USER' : 'SUPER_ADMIN';
    await adminApi.updateUser(accessToken, u.id, { role: nextRole });
    users.refetch();
  }

  const stats = overview.data;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-purple-400" />
          <h1 className="text-2xl font-bold text-white" data-testid="admin-page-title">Platform Admin</h1>
        </div>
        <p className="mt-1 text-sm text-slate-400">Manage workspaces and users across the platform.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Users', value: stats?.users, icon: Users },
          { label: 'Workspaces', value: stats?.workspaces, icon: Building2 },
          { label: 'Active workspaces', value: stats?.activeWorkspaces, icon: Building2 },
          { label: 'Requests (24h)', value: stats?.requestsToday, icon: Activity },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {overview.loading ? '…' : (value ?? 0).toLocaleString()}
                </p>
              </div>
              <Icon className="h-5 w-5 text-slate-600" />
            </div>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 border-b border-slate-800">
        {(['workspaces', 'users'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-testid={`admin-tab-${t}`}
            className={`px-4 py-2 text-sm font-medium capitalize ${
              tab === t ? 'border-b-2 border-purple-500 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'workspaces' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Members</th>
                  <th className="px-4 py-3">Requests</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {workspaces.loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : (
                  workspaces.data?.data.map((ws) => (
                    <tr key={ws.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-white">{ws.name}</p>
                        <p className="text-xs text-slate-500">{ws.slug}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={ws.plan === 'FREE' ? 'muted' : 'info'}>{ws.plan}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{ws._count.members}</td>
                      <td className="px-4 py-3 text-slate-400">{ws._count.requests.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleWorkspacePlan(ws)}
                          data-testid={`admin-cycle-plan-${ws.slug}`}
                          className="text-xs text-purple-400 hover:text-purple-300"
                        >
                          Cycle plan
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'users' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Verified</th>
                  <th className="px-4 py-3">Workspaces</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {users.loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : (
                  users.data?.data.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-white">{u.name}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={u.role === 'SUPER_ADMIN' ? 'warning' : 'muted'}>{u.role}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{u.emailVerified ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-3 text-slate-400">{u._count.workspaceMemberships}</td>
                      <td className="px-4 py-3">
                        {u.id !== user?.id && (
                          <button
                            type="button"
                            onClick={() => toggleUserRole(u)}
                            className="text-xs text-purple-400 hover:text-purple-300"
                          >
                            Toggle super-admin
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
