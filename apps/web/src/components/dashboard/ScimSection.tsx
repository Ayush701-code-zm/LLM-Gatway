'use client';

import { useCallback, useState } from 'react';
import { Loader2, Users, Copy, Check, RefreshCcw } from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import { workspaceApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function ScimSection({ plan }: { plan: string }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isEnterprise = plan === 'ENTERPRISE';

  const scim = useApi(
    useCallback((t) => (isEnterprise ? workspaceApi.scim(t) : Promise.reject(new Error('skip'))), [isEnterprise]),
  );

  const { mutate: save, loading: saving } = useMutation(
    (t, data: { enabled?: boolean; regenerateToken?: boolean }) => workspaceApi.updateScim(t, data),
  );

  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function handleToggle(enabled: boolean) {
    setError('');
    try {
      const result = await save({ enabled });
      if (result?.token) setRevealedToken(result.token);
      scim.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update SCIM');
    }
  }

  async function handleRegenerate() {
    setError('');
    try {
      const result = await save({ regenerateToken: true });
      if (result?.token) setRevealedToken(result.token);
      scim.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate token');
    }
  }

  function copyToken() {
    if (!revealedToken) return;
    navigator.clipboard.writeText(revealedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!isEnterprise) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-400" />
            SCIM provisioning
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-400">
            Automated user provisioning via SCIM 2.0 is available on the{' '}
            <Badge variant="info">Enterprise</Badge> plan.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-400" />
            SCIM provisioning
          </CardTitle>
          <Badge variant={scim.data?.enabled ? 'success' : 'muted'}>
            {scim.data?.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {scim.loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          </div>
        ) : scim.error ? (
          <p className="text-sm text-red-400">{scim.error}</p>
        ) : scim.data ? (
          <>
            <p className="text-sm text-slate-400">
              Connect Okta, Azure AD, or another IdP to provision workspace members automatically.
            </p>

            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">SCIM base URL</p>
              <p className="font-mono text-xs text-slate-300 break-all">{scim.data.baseUrl}</p>
              {scim.data.tokenPrefix && (
                <p className="text-xs text-slate-500">Token: {scim.data.tokenPrefix}</p>
              )}
            </div>

            {revealedToken && (
              <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3">
                <p className="mb-2 text-xs text-amber-300">Copy this token now — it won&apos;t be shown again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-slate-950 px-2 py-1 text-xs text-white">
                    {revealedToken}
                  </code>
                  <Button type="button" size="sm" variant="ghost" onClick={copyToken}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={scim.data.enabled ? 'outline' : 'primary'}
                disabled={saving}
                onClick={() => handleToggle(!scim.data!.enabled)}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : scim.data.enabled ? 'Disable SCIM' : 'Enable SCIM'}
              </Button>
              {scim.data.hasToken && (
                <Button size="sm" variant="outline" disabled={saving} onClick={handleRegenerate}>
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Rotate token
                </Button>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
