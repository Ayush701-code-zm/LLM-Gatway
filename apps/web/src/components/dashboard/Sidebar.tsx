'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  BarChart3,
  List,
  Key,
  Settings,
  Activity,
  DollarSign,
  Zap,
  LogOut,
  Users,
  ChevronDown,
  CreditCard,
  Bell,
  Webhook,
  Shield,
  Cpu,
  ClipboardList,
  Check,
  Plus,
  ShieldCheck,
  Radar,
} from 'lucide-react';
import { selectCurrentWorkspace, useAuthStore } from '@/store/auth';
import { authApi, workspaceApi } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/analytics',   icon: BarChart3,        label: 'Analytics' },
  { href: '/requests',    icon: List,             label: 'Requests' },
  { href: '/cost-explorer', icon: DollarSign,     label: 'Cost Explorer' },
  { href: '/providers',   icon: Activity,         label: 'Providers' },
  { href: '/models',      icon: Cpu,              label: 'Models' },
  { href: '/reliability', icon: Shield,           label: 'Reliability' },
  { href: '/anomalies',   icon: Radar,            label: 'Anomalies' },
  { href: '/cache',       icon: Zap,              label: 'Cache' },
  { href: '/api-keys',    icon: Key,              label: 'API Keys' },
  { href: '/webhooks',    icon: Webhook,          label: 'Webhooks' },
  { href: '/notifications', icon: Bell,           label: 'Notifications' },
  { href: '/audit-log',   icon: ClipboardList,    label: 'Audit Log' },
  { href: '/team',        icon: Users,            label: 'Team' },
  { href: '/settings',    icon: Settings,         label: 'Settings' },
];

const ADMIN_NAV = { href: '/admin', icon: ShieldCheck, label: 'Admin' };

const PLAN_COLORS: Record<string, string> = {
  FREE: 'text-slate-400 bg-slate-800',
  PRO: 'text-blue-300 bg-blue-900/50',
  ENTERPRISE: 'text-purple-300 bg-purple-900/50',
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const currentWorkspaceId = useAuthStore((s) => s.currentWorkspaceId);
  const setAuth = useAuthStore((s) => s.setAuth);
  const logout = useAuthStore((s) => s.logout);
  const currentWorkspace = useAuthStore(selectCurrentWorkspace);
  const workspace = useApi(useCallback((t) => workspaceApi.current(t), []));
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const workspaceRef = useRef<HTMLDivElement>(null);

  const plan = workspace.data?.plan ?? 'FREE';
  const workspaces = user?.workspaces ?? [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node)) {
        setWorkspaceOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setWorkspaceOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !newWorkspaceName.trim() || creating) return;
    setCreating(true);
    try {
      const { user: updatedUser, tokens } = await workspaceApi.create(accessToken, newWorkspaceName.trim());
      setAuth(updatedUser, tokens.accessToken, tokens.refreshToken, updatedUser.workspaces.at(-1)?.id);
      setShowCreateModal(false);
      setNewWorkspaceName('');
      setWorkspaceOpen(false);
      router.refresh();
    } catch {
      // keep modal open on failure
    } finally {
      setCreating(false);
    }
  }

  async function handleSwitchWorkspace(workspaceId: string) {
    if (!accessToken || workspaceId === currentWorkspaceId || switching) return;
    setSwitching(workspaceId);
    setSwitchError('');
    try {
      const { user: updatedUser, tokens } = await authApi.switchWorkspace(workspaceId, accessToken);
      setAuth(updatedUser, tokens.accessToken, tokens.refreshToken, workspaceId);
      setWorkspaceOpen(false);
      workspace.refetch();
      router.refresh();
    } catch {
      setSwitchError('Could not switch workspace. Try again.');
    } finally {
      setSwitching(null);
    }
  }

  async function handleLogout() {
    if (accessToken && refreshToken) {
      authApi.logout(refreshToken, accessToken).catch(() => {});
    }
    logout();
    router.push('/login');
  }

  return (
    <aside className="flex w-60 flex-col border-r border-slate-800 bg-slate-900">
      {/* Logo */}
      <Link href="/dashboard" className="flex items-center gap-2.5 border-b border-slate-800 px-5 py-4 transition-opacity hover:opacity-80">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 shadow-lg shadow-blue-600/20">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-white">SmartRoute AI</p>
          <p className="text-[10px] text-slate-500 leading-tight">AI Gateway</p>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href as Route}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-white',
              )}
            >
              <Icon className={cn('h-4 w-4 flex-shrink-0', active && 'text-blue-400')} />
              {label}
            </Link>
          );
        })}
        {user?.role === 'SUPER_ADMIN' && (() => {
          const { href, icon: Icon, label } = ADMIN_NAV;
          const active = pathname.startsWith(href);
          return (
            <Link
              href={href as Route}
              data-testid="nav-admin"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-purple-900/40 text-purple-200'
                  : 'text-purple-400/70 hover:bg-purple-900/20 hover:text-purple-200',
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })()}
      </nav>

      {/* Workspace + User footer */}
      <div className="border-t border-slate-800 p-3 space-y-2">
        {/* Workspace badge */}
        {currentWorkspace && (
          <div className="relative" ref={workspaceRef}>
            <button
              type="button"
              data-testid="workspace-switcher"
              aria-expanded={workspaceOpen}
              aria-label="Switch workspace"
              onClick={() => setWorkspaceOpen((o) => !o)}
              className="w-full rounded-lg bg-slate-800 px-3 py-2 text-left transition-colors hover:bg-slate-700 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-white">{currentWorkspace.name}</p>
                  <p className="truncate text-[10px] font-mono text-slate-500">@{currentWorkspace.slug}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className={cn('inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium', PLAN_COLORS[plan] ?? PLAN_COLORS.FREE)}>
                      {plan.charAt(0) + plan.slice(1).toLowerCase()}
                    </span>
                    <span className="text-[10px] text-slate-600">{currentWorkspace.role.toLowerCase()}</span>
                  </div>
                </div>
                <ChevronDown className={cn('h-3 w-3 flex-shrink-0 text-slate-500 transition-transform', workspaceOpen && 'rotate-180')} />
              </div>
            </button>

            {workspaceOpen && (
              <div
                role="menu"
                className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
              >
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    role="menuitem"
                    data-testid={`workspace-option-${ws.slug}`}
                    disabled={switching === ws.id}
                    onClick={() => handleSwitchWorkspace(ws.id)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-slate-800 disabled:opacity-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{ws.name}</p>
                      <p className="truncate font-mono text-[10px] text-slate-500">@{ws.slug}</p>
                      <p className="text-[10px] text-slate-600">{ws.role.toLowerCase()}</p>
                    </div>
                    {ws.id === currentWorkspaceId && <Check className="h-3 w-3 flex-shrink-0 text-blue-400" />}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceOpen(false);
                    setShowCreateModal(true);
                  }}
                  className="flex w-full items-center gap-2 border-t border-slate-800 px-3 py-2 text-left text-xs text-blue-400 hover:bg-slate-800"
                >
                  <Plus className="h-3 w-3" />
                  Create workspace
                </button>
              </div>
            )}
            {switchError && (
              <p className="mt-1 text-[10px] text-red-400">{switchError}</p>
            )}
          </div>
        )}

        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <form
              onSubmit={handleCreateWorkspace}
              className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl"
            >
              <h3 className="text-sm font-semibold text-white">Create workspace</h3>
              <input
                type="text"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="Workspace name"
                required
                minLength={2}
                maxLength={60}
                className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* User row */}
        <div className="flex items-center justify-between px-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
              {user?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-white">{user?.name ?? '—'}</p>
              <p className="truncate text-[10px] text-slate-500">{user?.email ?? ''}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Upgrade prompt for free plan */}
        {plan === 'FREE' && (
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-lg border border-blue-900/50 bg-blue-950/30 px-3 py-2 transition-colors hover:border-blue-800/60"
          >
            <CreditCard className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs text-blue-400">Upgrade to Pro</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
