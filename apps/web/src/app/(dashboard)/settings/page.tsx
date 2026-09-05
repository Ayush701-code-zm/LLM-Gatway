'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Save, Plus, X } from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import {
  workspaceApi,
  authApi,
  type ProviderName,
  type RoutingStrategy,
  type UpdateWorkspaceInput,
  type CreateBudgetInput,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { selectCurrentWorkspace, useAuthStore } from '@/store/auth';
import { formatCurrency } from '@/lib/utils';
import { dispatchNotificationsChanged } from '@/lib/notifications';
import { BudgetProgress } from '@/components/dashboard/BudgetProgress';
import { BillingSection } from '@/components/dashboard/BillingSection';
import { MfaSection } from '@/components/dashboard/MfaSection';
import { SessionsSection } from '@/components/dashboard/SessionsSection';
import { SsoSection } from '@/components/dashboard/SsoSection';
import { ScimSection } from '@/components/dashboard/ScimSection';
import { DataPrivacySection } from '@/components/dashboard/DataPrivacySection';
import { LeaveWorkspaceSection } from '@/components/dashboard/LeaveWorkspaceSection';
import { WorkspaceSlugSchema } from '@smartroute/shared';

const ROUTING_STRATEGIES: { value: RoutingStrategy; label: string }[] = [
  { value: 'COST_OPTIMIZED', label: 'Cost optimized' },
  { value: 'LATENCY_OPTIMIZED', label: 'Latency optimized' },
  { value: 'PRIORITY_BASED', label: 'Priority based' },
  { value: 'ROUND_ROBIN', label: 'Round robin' },
  { value: 'WEIGHTED_RANDOM', label: 'Weighted random' },
];

const PROVIDERS: { value: ProviderName; label: string }[] = [
  { value: 'OPENAI', label: 'OpenAI' },
  { value: 'ANTHROPIC', label: 'Anthropic' },
  { value: 'GOOGLE', label: 'Google Gemini' },
  { value: 'COHERE', label: 'Cohere' },
  { value: 'MISTRAL', label: 'Mistral' },
  { value: 'OLLAMA', label: 'Ollama (local)' },
];

const BUDGET_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'TOTAL'] as const;

function CreateBudgetModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: CreateBudgetInput) => Promise<void>;
}) {
  const [form, setForm] = useState<CreateBudgetInput>({
    name: 'Monthly budget',
    limitUsd: 100,
    period: 'MONTHLY',
    alertAt80: true,
    alertAt90: true,
    blockAt100: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onCreate(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create budget');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Create budget</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <Input
            label="Limit (USD)"
            type="number"
            min={0.01}
            step={0.01}
            value={form.limitUsd}
            onChange={(e) => setForm((f) => ({ ...f, limitUsd: parseFloat(e.target.value) }))}
            required
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Period</label>
            <select
              value={form.period}
              onChange={(e) => setForm((f) => ({ ...f, period: e.target.value as CreateBudgetInput['period'] }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              {BUDGET_PERIODS.map((p) => (
                <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create budget'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-slate-400">Loading settings…</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const billingNotice = searchParams.get('billing');
  const { user, updateUser } = useAuthStore();
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const currentRole = useAuthStore((s) => selectCurrentWorkspace(s)?.role ?? 'MEMBER');
  const canAdmin = ['OWNER', 'ADMIN'].includes(currentRole);

  const workspace = useApi(useCallback((t) => workspaceApi.current(t), []));
  const budgets = useApi(useCallback((t) => workspaceApi.budgets(t), []));

  const { mutate: updateWorkspace, loading: saving, error: saveError } = useMutation(
    (t, data: UpdateWorkspaceInput) => workspaceApi.update(t, data),
  );
  const { mutate: createBudget, error: budgetError } = useMutation(
    (t, data: CreateBudgetInput) => workspaceApi.createBudget(t, data),
  );

  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [form, setForm] = useState<UpdateWorkspaceInput>({});
  const [slugError, setSlugError] = useState('');
  const [allProviders, setAllProviders] = useState(true);

  const ws = workspace.data;

  useEffect(() => {
    if (user?.name) setProfileName(user.name);
  }, [user?.name]);

  useEffect(() => {
    if (!ws) return;
    setForm({
      name: ws.name,
      slug: ws.slug,
      defaultRoutingStrategy: ws.defaultRoutingStrategy,
      semanticCacheEnabled: ws.semanticCacheEnabled,
      cacheThreshold: ws.cacheThreshold,
      allowedProviders: ws.allowedProviders,
      requestsPerMinute: ws.requestsPerMinute,
      requestsPerDay: ws.requestsPerDay,
      tokensPerMinute: ws.tokensPerMinute,
    });
    setAllProviders(!ws.allowedProviders?.length);
  }, [ws]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdmin) return;

    setSlugError('');
    if (form.slug) {
      const parsed = WorkspaceSlugSchema.safeParse(form.slug);
      if (!parsed.success) {
        setSlugError(parsed.error.issues[0]?.message ?? 'Invalid slug');
        return;
      }
    }

    const payload: UpdateWorkspaceInput = {
      ...form,
      allowedProviders: allProviders ? [] : (form.allowedProviders ?? []),
    };

    const result = await updateWorkspace(payload);
    if (result) {
      setSaved(true);
      workspace.refetch();
      if (user && result.slug) {
        updateUser({
          ...user,
          workspaces: user.workspaces.map((w) =>
            w.id === result.id ? { ...w, slug: result.slug, name: result.name } : w,
          ),
        });
      }
      if (ws && payload.slug && payload.slug !== ws.slug) {
        dispatchNotificationsChanged();
      }
      setTimeout(() => setSaved(false), 2500);
    }
  }

  async function handleCreateBudget(data: CreateBudgetInput) {
    const result = await createBudget(data);
    if (!result) {
      throw new Error(budgetError ?? 'Failed to create budget');
    }
    budgets.refetch();
    workspace.refetch();
  }

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setProfileSaving(true);
    setProfileError('');
    setProfileSaved(false);
    try {
      const updated = await authApi.updateProfile(accessToken, { name: profileName.trim() });
      updateUser(updated);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch {
      setProfileError('Could not update profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setPasswordSaving(true);
    setPasswordError('');
    setPasswordMessage('');
    try {
      await authApi.changePassword(accessToken, {
        currentPassword: passwordForm.current,
        newPassword: passwordForm.next,
      });
      setPasswordMessage('Password updated.');
      setPasswordForm({ current: '', next: '', confirm: '' });
    } catch {
      setPasswordError('Could not change password. Check your current password.');
    } finally {
      setPasswordSaving(false);
    }
  }

  function toggleProvider(provider: ProviderName) {
    setAllProviders(false);
    setForm((f) => {
      const current = f.allowedProviders ?? [];
      const next = current.includes(provider)
        ? current.filter((p) => p !== provider)
        : [...current, provider];
      return { ...f, allowedProviders: next };
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-0.5 text-sm text-slate-400">Workspace configuration and budgets</p>
      </div>

      {!canAdmin && (
        <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
          You have read-only access. Contact an admin to change workspace settings.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Workspace info (read-only summary) */}
        <Card>
          <CardHeader><CardTitle>Workspace</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Row label="Slug" value={ws?.slug ? `@${ws.slug}` : '—'} />
            <Row
              label="Plan"
              value={
                <Badge variant={ws?.plan === 'FREE' ? 'muted' : ws?.plan === 'PRO' ? 'default' : 'info'}>
                  {ws?.plan?.toLowerCase() ?? 'free'}
                </Badge>
              }
            />
            <Row label="Total Requests" value={ws?._count.requests.toLocaleString() ?? '—'} />
            <Row label="API Keys" value={ws?._count.apiKeys.toString() ?? '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Your Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Row label="Email" value={user?.email ?? '—'} />
            <Row
              label="Verified"
              value={
                user?.emailVerified ? (
                  <Badge variant="success">Yes</Badge>
                ) : (
                  <Badge variant="warning">Pending</Badge>
                )
              }
            />
            <Row label="Role" value={<Badge variant="info">{currentRole.toLowerCase()}</Badge>} />

            <form onSubmit={handleProfileSave} className="space-y-3 border-t border-slate-800 pt-4">
              <Input
                label="Display name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
              {profileError && <p className="text-sm text-red-400">{profileError}</p>}
              {profileSaved && <p className="text-sm text-emerald-400">Profile updated.</p>}
              <Button type="submit" size="sm" disabled={profileSaving}>
                {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save profile'}
              </Button>
            </form>

            <form onSubmit={handlePasswordChange} className="space-y-3 border-t border-slate-800 pt-4">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Change password</p>
              <Input
                label="Current password"
                type="password"
                value={passwordForm.current}
                onChange={(e) => setPasswordForm((f) => ({ ...f, current: e.target.value }))}
              />
              <Input
                label="New password"
                type="password"
                value={passwordForm.next}
                onChange={(e) => setPasswordForm((f) => ({ ...f, next: e.target.value }))}
              />
              <Input
                label="Confirm new password"
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
              />
              {passwordError && <p className="text-sm text-red-400">{passwordError}</p>}
              {passwordMessage && <p className="text-sm text-emerald-400">{passwordMessage}</p>}
              <Button type="submit" size="sm" variant="secondary" disabled={passwordSaving}>
                {passwordSaving ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <MfaSection />

      <SessionsSection />

      <SsoSection plan={workspace.data?.plan ?? 'FREE'} />

      <ScimSection plan={workspace.data?.plan ?? 'FREE'} />

      <DataPrivacySection />

      <LeaveWorkspaceSection />

      <BillingSection billingNotice={billingNotice} />

      {/* Editable workspace settings */}
      <Card>
        <CardHeader>
          <CardTitle>Gateway settings</CardTitle>
        </CardHeader>
        <CardContent>
          {workspace.loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">
              {saveError && <p className="text-sm text-red-400">{saveError}</p>}
              {saved && <p className="text-sm text-emerald-400">Settings saved successfully.</p>}

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Workspace name"
                  value={form.name ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={!canAdmin}
                />
                <Input
                  id="workspace-slug"
                  label="Workspace slug"
                  hint="Used for SSO sign-in. Lowercase letters, numbers, and hyphens."
                  value={form.slug ?? ''}
                  error={slugError || undefined}
                  onChange={(e) => {
                    setSlugError('');
                    setForm((f) => ({
                      ...f,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40),
                    }));
                  }}
                  disabled={!canAdmin}
                />
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Routing strategy</label>
                  <select
                    value={form.defaultRoutingStrategy ?? 'COST_OPTIMIZED'}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, defaultRoutingStrategy: e.target.value as RoutingStrategy }))
                    }
                    disabled={!canAdmin}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {ROUTING_STRATEGIES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.semanticCacheEnabled ?? true}
                    onChange={(e) => setForm((f) => ({ ...f, semanticCacheEnabled: e.target.checked }))}
                    disabled={!canAdmin}
                    className="rounded border-slate-600"
                  />
                  Semantic cache enabled
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-slate-300">Similarity threshold</label>
                  <input
                    type="number"
                    min={0.5}
                    max={1}
                    step={0.01}
                    value={form.cacheThreshold ?? 0.92}
                    onChange={(e) => setForm((f) => ({ ...f, cacheThreshold: parseFloat(e.target.value) }))}
                    disabled={!canAdmin}
                    className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-300">Allowed providers</p>
                <label className="mb-3 flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={allProviders}
                    onChange={(e) => {
                      setAllProviders(e.target.checked);
                      if (e.target.checked) setForm((f) => ({ ...f, allowedProviders: [] }));
                    }}
                    disabled={!canAdmin}
                    className="rounded border-slate-600"
                  />
                  Allow all providers (default)
                </label>
                {!allProviders && (
                  <div className="flex flex-wrap gap-2">
                    {PROVIDERS.map((p) => {
                      const selected = (form.allowedProviders ?? []).includes(p.value);
                      return (
                        <button
                          key={p.value}
                          type="button"
                          disabled={!canAdmin}
                          onClick={() => toggleProvider(p.value)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                            selected
                              ? 'border-blue-500 bg-blue-900/40 text-blue-300'
                              : 'border-slate-700 text-slate-400 hover:border-slate-600'
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-300">Rate limit overrides</p>
                <p className="mb-3 text-xs text-slate-500">Leave blank to use your plan defaults.</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="Requests / minute"
                    type="number"
                    min={1}
                    value={form.requestsPerMinute ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        requestsPerMinute: e.target.value ? parseInt(e.target.value, 10) : null,
                      }))
                    }
                    disabled={!canAdmin}
                    placeholder="Plan default"
                  />
                  <Input
                    label="Requests / day"
                    type="number"
                    min={1}
                    value={form.requestsPerDay ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        requestsPerDay: e.target.value ? parseInt(e.target.value, 10) : null,
                      }))
                    }
                    disabled={!canAdmin}
                    placeholder="Plan default"
                  />
                  <Input
                    label="Tokens / minute"
                    type="number"
                    min={1}
                    value={form.tokensPerMinute ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        tokensPerMinute: e.target.value ? parseInt(e.target.value, 10) : null,
                      }))
                    }
                    disabled={!canAdmin}
                    placeholder="Plan default"
                  />
                </div>
              </div>

              {canAdmin && (
                <div className="flex justify-end">
                  <Button type="submit" disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? 'Saving…' : 'Save settings'}
                  </Button>
                </div>
              )}
            </form>
          )}
        </CardContent>
      </Card>

      {/* Budgets */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Budgets</CardTitle>
            {canAdmin && (
              <Button size="sm" onClick={() => setShowBudgetModal(true)}>
                <Plus className="h-4 w-4" />
                Add budget
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {budgets.loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
            </div>
          ) : (
            <>
              <BudgetProgress budgets={budgets.data ?? []} />
              {budgets.data?.length ? (
                <div className="mt-4 space-y-2 border-t border-slate-800 pt-4">
                  {budgets.data.map((b) => (
                    <div key={b.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">{b.name} · {b.period.toLowerCase()}</span>
                      <span className="text-white">
                        {formatCurrency(b.currentSpend, 2)} / {formatCurrency(b.limitUsd, 0)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {showBudgetModal && (
        <CreateBudgetModal
          onClose={() => setShowBudgetModal(false)}
          onCreate={handleCreateBudget}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}
