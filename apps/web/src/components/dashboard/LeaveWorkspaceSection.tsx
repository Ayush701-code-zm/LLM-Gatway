'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogOut } from 'lucide-react';
import { memberApi, SmartRouteApiError } from '@/lib/api';
import { selectCurrentWorkspace, useAuthStore } from '@/store/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function LeaveWorkspaceSection() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const workspace = useAuthStore(selectCurrentWorkspace);
  const setAuth = useAuthStore((s) => s.setAuth);
  const logout = useAuthStore((s) => s.logout);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLeave() {
    if (!accessToken || !workspace) return;
    const msg =
      workspace.role === 'OWNER'
        ? `Leave and deactivate "${workspace.name}"? This cannot be undone unless you are the sole member.`
        : `Leave "${workspace.name}"? You will lose access to this workspace.`;
    if (!confirm(msg)) return;

    setLoading(true);
    setError('');
    try {
      const result = await memberApi.leave(accessToken);
      if (result.noWorkspacesRemaining) {
        logout();
        router.push('/login');
        return;
      }
      if (result.user && result.tokens) {
        setAuth(result.user, result.tokens.accessToken, result.tokens.refreshToken);
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof SmartRouteApiError ? err.message : 'Failed to leave workspace');
    } finally {
      setLoading(false);
    }
  }

  if (!workspace) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LogOut className="h-5 w-5 text-slate-400" />
          Leave workspace
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-400">
          {workspace.role === 'OWNER'
            ? 'As owner, you must transfer ownership before leaving if other members remain. If you are the only member, the workspace will be deactivated.'
            : 'Remove yourself from this workspace. You can be re-invited later.'}
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button variant="outline" size="sm" onClick={handleLeave} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Leave workspace'}
        </Button>
      </CardContent>
    </Card>
  );
}
