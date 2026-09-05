'use client';

import { useCallback, useState } from 'react';
import { Loader2, Shield, Copy, Check, ExternalLink } from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import { workspaceApi, type SsoConfig } from '@/lib/api';
import { useAuthStore, selectCurrentWorkspace } from '@/store/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export function SsoSection({ plan }: { plan: string }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const workspace = useAuthStore(selectCurrentWorkspace);
  const isEnterprise = plan === 'ENTERPRISE';

  const sso = useApi(
    useCallback((t) => (isEnterprise ? workspaceApi.sso(t) : Promise.reject(new Error('skip'))), [isEnterprise]),
  );

  const { mutate: save, loading: saving } = useMutation(
    (t, data: { enabled?: boolean; metadataUrl?: string | null; entityId?: string | null }) =>
      workspaceApi.updateSso(t, data),
  );

  const [form, setForm] = useState<{ enabled: boolean; metadataUrl: string; entityId: string } | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const config = sso.data ?? undefined;
  const display = form ?? (config ? {
    enabled: config.enabled,
    metadataUrl: config.metadataUrl ?? '',
    entityId: config.entityId ?? '',
  } : null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!display) return;
    setError('');
    setSaved(false);
    try {
      await save({
        enabled: display.enabled,
        metadataUrl: display.metadataUrl.trim() || null,
        entityId: display.entityId.trim() || null,
      });
      setSaved(true);
      sso.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save SSO settings');
    }
  }

  function copyText(label: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  if (!isEnterprise) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-400" />
            Enterprise SSO (SAML)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-400">
            SAML single sign-on is available on the <Badge variant="info">Enterprise</Badge> plan.
            Upgrade in Billing to configure your identity provider.
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
            <Shield className="h-5 w-5 text-slate-400" />
            Enterprise SSO (SAML)
          </CardTitle>
          {config ? (
            <Badge variant={config.implemented ? 'success' : 'warning'}>
              {config.implemented ? 'Active' : 'Configure IdP metadata'}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {sso.loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          </div>
        ) : sso.error ? (
          <p className="text-sm text-red-400">{sso.error}</p>
        ) : config && display ? (
          <form onSubmit={handleSave} className="space-y-4">
            <p className="text-sm text-slate-400">
              Paste your IdP metadata URL — we fetch the SSO endpoint and certificate automatically.
              {config.idpConfigured ? ' SAML login is active.' : ' Save a metadata URL to enable login.'}
            </p>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={display.enabled}
                onChange={(e) => setForm({ ...display, enabled: e.target.checked })}
                className="rounded border-slate-600"
              />
              Enable SSO for this workspace
            </label>

            <Input
              label="IdP metadata URL"
              value={display.metadataUrl}
              onChange={(e) => setForm({ ...display, metadataUrl: e.target.value })}
              placeholder="https://idp.example.com/metadata"
            />
            <Input
              label="IdP entity ID (optional)"
              value={display.entityId}
              onChange={(e) => setForm({ ...display, entityId: e.target.value })}
              placeholder="urn:idp:example"
            />

            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Service provider URLs</p>
              {[
                { label: 'ACS URL', value: config.acsUrl },
                { label: 'SP entity ID', value: config.spEntityId },
                { label: 'SP metadata', value: config.spMetadataUrl },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-500">{label}</p>
                    <p className="truncate font-mono text-xs text-slate-300">{value}</p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => copyText(label, value)}>
                    {copied === label ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {saved && <p className="text-sm text-emerald-400">SSO settings saved.</p>}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save SSO settings'}
              </Button>
              {config.loginUrl && (
                <a
                  href={config.loginUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
                >
                  Test login URL <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
