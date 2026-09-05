'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, AlertCircle, Loader2, Shield } from 'lucide-react';
import { authApi, SmartRouteApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [form, setForm] = useState({ email: '', password: '' });
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [ssoInfo, setSsoInfo] = useState<{ enabled: boolean; loginUrl?: string | null; workspaceName?: string } | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const redirectTo = searchParams.get('redirect');

  useEffect(() => {
    if (searchParams.get('error') === 'oauth_failed') {
      setError('Google sign-in failed. Check OAuth env vars or try email login.');
    }
  }, [searchParams]);

  useEffect(() => {
    const slug = workspaceSlug.trim();
    if (!slug) {
      setSsoInfo(null);
      return;
    }
    const timer = setTimeout(() => {
      authApi
        .discoverSaml(slug)
        .then(setSsoInfo)
        .catch(() => setSsoInfo(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [workspaceSlug]);

  function goAfterAuth() {
    const target = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/dashboard';
    router.push(target as Route);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await authApi.login(form.email, form.password);
      if ('mfaRequired' in result && result.mfaRequired) {
        setMfaToken(result.mfaToken);
        return;
      }
      if ('user' in result && result.tokens) {
        setAuth(result.user, result.tokens.accessToken, result.tokens.refreshToken);
        goAfterAuth();
      }
    } catch (err) {
      if (err instanceof SmartRouteApiError) {
        setError(err.message);
      } else {
        setError('Network error. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError('');
    setLoading(true);

    try {
      const { user, tokens } = await authApi.verifyMfaLogin(mfaToken, mfaCode);
      setAuth(user, tokens.accessToken, tokens.refreshToken);
      goAfterAuth();
    } catch (err) {
      if (err instanceof SmartRouteApiError) {
        setError(err.message);
      } else {
        setError('Invalid code. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-blue-600/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[600px] w-[600px] rounded-full bg-purple-600/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">SmartRoute AI</span>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            AI Gateway & Cost Optimization Platform
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl backdrop-blur">
          {mfaToken ? (
            <>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-900/40 text-emerald-400">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-white">Two-factor authentication</h1>
                  <p className="text-sm text-slate-400">Enter the code from your authenticator app</p>
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-center font-mono text-lg tracking-widest text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading || mfaCode.length < 6}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMfaToken(null); setMfaCode(''); setError(''); }}
                  className="w-full text-sm text-slate-500 hover:text-slate-300"
                >
                  Back to sign in
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="mb-1 text-xl font-semibold text-white">Welcome back</h1>
              <p className="mb-6 text-sm text-slate-400">Sign in to your workspace</p>

              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-800/50 bg-red-900/20 px-3 py-2.5 text-sm text-red-400">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-300">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="you@company.com"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="password" className="text-sm font-medium text-slate-300">
                      Password
                    </label>
                    <Link href="/forgot-password" className="text-xs text-blue-400 hover:text-blue-300">
                      Forgot password?
                    </Link>
                  </div>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="workspace" className="mb-1.5 block text-sm font-medium text-slate-300">
                    Workspace slug <span className="text-slate-500">(optional, for SSO)</span>
                  </label>
                  <input
                    id="workspace"
                    type="text"
                    value={workspaceSlug}
                    onChange={(e) => setWorkspaceSlug(e.target.value)}
                    placeholder="acme-corp-a1b2"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {ssoInfo?.enabled && ssoInfo.loginUrl && (
                  <a
                    href={ssoInfo.loginUrl}
                    data-testid="sso-sign-in-link"
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
                  >
                    <Shield className="h-4 w-4 text-emerald-400" />
                    Sign in with SSO{ssoInfo.workspaceName ? ` · ${ssoInfo.workspaceName}` : ''}
                  </a>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <GoogleOAuthButton />

              <p className="mt-5 text-center text-sm text-slate-500">
                Don&apos;t have an account?{' '}
                <Link href="/register" className="font-medium text-blue-400 hover:text-blue-300">
                  Create one free
                </Link>
              </p>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          By signing in, you agree to our{' '}
          <Link href="/terms" className="underline hover:text-slate-400">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="underline hover:text-slate-400">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
