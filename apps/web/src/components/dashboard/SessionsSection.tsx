'use client';

import { useCallback } from 'react';
import { Loader2, Monitor, Trash2 } from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/utils';

export function SessionsSection() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);

  const sessions = useApi(useCallback((t) => authApi.sessions(t), []));
  const { mutate: revokeOne, loading: revokingOne } = useMutation(
    (t, sessionId: string) => authApi.revokeSession(t, sessionId),
  );
  const { mutate: revokeOthers, loading: revokingOthers } = useMutation(
    (t, rt: string) => authApi.revokeOtherSessions(t, rt),
  );

  async function handleRevoke(sessionId: string) {
    await revokeOne(sessionId);
    sessions.refetch();
  }

  async function handleRevokeOthers() {
    if (!refreshToken) return;
    await revokeOthers(refreshToken);
    sessions.refetch();
  }

  return (
    <Card data-testid="sessions-section">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-slate-400" />
            Active sessions
          </CardTitle>
          {(sessions.data?.length ?? 0) > 1 && (
            <Button
              size="sm"
              variant="outline"
              data-testid="sessions-revoke-others"
              disabled={revokingOthers || !accessToken}
              onClick={handleRevokeOthers}
            >
              {revokingOthers && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign out other devices
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {sessions.loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          </div>
        ) : !sessions.data?.length ? (
          <p className="text-sm text-slate-500">No active sessions found.</p>
        ) : (
          <div className="space-y-3">
            {sessions.data.map((s, index) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {s.userAgent?.slice(0, 80) ?? 'Unknown device'}
                    {index === 0 && (
                      <span className="ml-2 text-xs text-emerald-400">current</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {s.ipAddress ?? 'Unknown IP'} · started {relativeTime(s.createdAt)}
                  </p>
                </div>
                {index !== 0 && (
                  <button
                    onClick={() => handleRevoke(s.id)}
                    disabled={revokingOne}
                    data-testid={`session-revoke-${s.id}`}
                    className="rounded-lg p-2 text-slate-500 hover:bg-red-950/30 hover:text-red-400"
                    title="Revoke session"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
