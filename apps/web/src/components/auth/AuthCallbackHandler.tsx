'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Shield, AlertCircle } from 'lucide-react';
import { authApi, SmartRouteApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface AuthCallbackHandlerProps {
  mfaDescription: string;
  loadingMessage: string;
  errorCode?: 'oauth_failed' | 'saml_failed';
}

export function AuthCallbackHandler({
  mfaDescription,
  loadingMessage,
  errorCode = 'oauth_failed',
}: AuthCallbackHandlerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const mfa = searchParams.get('mfaToken');
    if (mfa) {
      setMfaToken(mfa);
      return;
    }

    const accessToken = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');

    if (!accessToken || !refreshToken) {
      router.replace(`/login?error=${errorCode}`);
      return;
    }

    authApi
      .me(accessToken)
      .then((user) => {
        setAuth(user, accessToken, refreshToken);
        router.replace('/dashboard');
      })
      .catch(() => router.replace(`/login?error=${errorCode}`));
  }, [searchParams, router, setAuth, errorCode]);

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError('');
    setLoading(true);

    try {
      const { user, tokens } = await authApi.verifyMfaLogin(mfaToken, mfaCode);
      setAuth(user, tokens.accessToken, tokens.refreshToken);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof SmartRouteApiError ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  if (mfaToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-900/40 text-emerald-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Two-factor authentication</h1>
              <p className="text-sm text-slate-400">{mfaDescription}</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-800/50 bg-red-900/20 px-3 py-2.5 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleMfaSubmit} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\s/g, '').slice(0, 16))}
              placeholder="6-digit code or backup code"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-center font-mono text-lg tracking-widest text-white"
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || mfaCode.length < 6}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Verify
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-400" />
        <p className="mt-4 text-slate-400">{loadingMessage}</p>
      </div>
    </div>
  );
}
