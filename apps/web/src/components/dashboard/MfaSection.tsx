'use client';

import { useCallback, useState } from 'react';
import { Loader2, Shield, ShieldCheck, Copy, Check } from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export function MfaSection() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const updateUser = useAuthStore((s) => s.updateUser);
  const user = useAuthStore((s) => s.user);

  const status = useApi(useCallback((t) => authApi.mfaStatus(t), []));
  const { mutate: setup, loading: settingUp } = useMutation<null, { otpauthUrl: string; secret: string }>(
    (t) => authApi.mfaSetup(t),
  );
  const { mutate: confirm, loading: confirming } = useMutation(
    (t, code: string) => authApi.mfaConfirm(t, code),
  );
  const { mutate: disable, loading: disabling } = useMutation(
    (t, data: { password: string; code: string }) => authApi.mfaDisable(t, data),
  );

  const [setupData, setSetupData] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disableForm, setDisableForm] = useState({ password: '', code: '' });
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const enabled = status.data?.enabled ?? user?.mfaEnabled ?? false;

  async function handleSetup() {
    setError('');
    const result = await setup(null);
    if (result) setSetupData(result);
    else setError('Could not start MFA setup');
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError('');
    const result = await confirm(confirmCode);
    if (result) {
      setBackupCodes(result.backupCodes);
      setSetupData(null);
      setConfirmCode('');
      updateUser(result.user);
      status.refetch();
    } else {
      setError('Invalid code. Check your authenticator app and try again.');
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = await disable(disableForm);
    if (result) {
      setDisableForm({ password: '', code: '' });
      updateUser(result.user);
      status.refetch();
    } else {
      setError('Could not disable MFA. Check your password and code.');
    }
  }

  function copyBackupCodes() {
    if (!backupCodes) return;
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-400" />
            Two-factor authentication
          </CardTitle>
          {enabled ? (
            <Badge variant="success" data-testid="mfa-status-badge">Enabled</Badge>
          ) : (
            <Badge variant="muted" data-testid="mfa-status-badge">Disabled</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-400">
          Protect your account with a TOTP authenticator app (Google Authenticator, 1Password, Authy).
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {backupCodes && (
          <div className="rounded-lg border border-yellow-800/50 bg-yellow-950/20 p-4">
            <p className="mb-2 text-sm font-medium text-yellow-300">Save these backup codes</p>
            <p className="mb-3 text-xs text-slate-400">
              Each code works once if you lose access to your authenticator.
            </p>
            <div className="mb-3 grid grid-cols-2 gap-1 font-mono text-sm text-white">
              {backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <Button size="sm" variant="secondary" onClick={copyBackupCodes}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy codes'}
            </Button>
          </div>
        )}

        {!enabled && !setupData && (
          <Button onClick={handleSetup} disabled={settingUp} data-testid="mfa-enable-button">
            {settingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Enable MFA
          </Button>
        )}

        {setupData && (
          <form onSubmit={handleConfirm} className="space-y-4 border-t border-slate-800 pt-4">
            <div>
              <p className="mb-2 text-sm text-slate-300">1. Scan this URL in your authenticator app</p>
              <code className="block break-all rounded-lg bg-slate-950 p-3 text-xs text-slate-400">
                {setupData.otpauthUrl}
              </code>
              <p className="mt-2 text-xs text-slate-500">
                Or enter secret manually:{' '}
                <span className="font-mono text-slate-400" data-testid="mfa-setup-secret">
                  {setupData.secret}
                </span>
              </p>
            </div>
            <Input
              label="2. Enter 6-digit code"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              data-testid="mfa-confirm-code"
            />
            <Button type="submit" disabled={confirming || confirmCode.length < 6} data-testid="mfa-confirm-button">
              {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm and enable
            </Button>
          </form>
        )}

        {enabled && (
          <form onSubmit={handleDisable} className="space-y-3 border-t border-slate-800 pt-4">
            <p className="text-sm text-slate-400">
              Backup codes remaining: {status.data?.backupCodesRemaining ?? '—'}
            </p>
            <Input
              label="Current password"
              type="password"
              value={disableForm.password}
              onChange={(e) => setDisableForm((f) => ({ ...f, password: e.target.value }))}
            />
            <Input
              label="Authenticator or backup code"
              value={disableForm.code}
              onChange={(e) => setDisableForm((f) => ({ ...f, code: e.target.value }))}
            />
            <Button type="submit" variant="danger" disabled={disabling}>
              {disabling && <Loader2 className="h-4 w-4 animate-spin" />}
              Disable MFA
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
