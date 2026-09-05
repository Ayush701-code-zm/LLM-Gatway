'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Zap, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { authApi, SmartRouteApiError } from '@/lib/api';
import { firstFieldErrorMessage } from '@smartroute/shared';
import { useAuthStore } from '@/store/auth';
import { GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton';

const FEATURES = [
  'Smart model routing (saves 30–60% cost)',
  'Semantic caching with pgvector',
  'Automatic provider failover',
  'Budget controls & alerts',
  'Full request observability',
];

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    workspaceName: '',
    workspaceSlug: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((f) => {
        const next = { ...f, [field]: value };
        if (field === 'workspaceName' && !slugTouched) {
          next.workspaceSlug = value
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40);
        }
        if (field === 'workspaceSlug') {
          setSlugTouched(true);
          next.workspaceSlug = value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
        }
        return next;
      });
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const payload = {
        name: form.name,
        email: form.email,
        password: form.password,
        ...(form.workspaceName ? { workspaceName: form.workspaceName } : {}),
        ...(form.workspaceSlug ? { workspaceSlug: form.workspaceSlug } : {}),
      };
      const { user, tokens } = await authApi.register(payload);
      setAuth(user, tokens.accessToken, tokens.refreshToken);
      router.push('/dashboard');
    } catch (err) {
      setError(
        err instanceof SmartRouteApiError
          ? (firstFieldErrorMessage(err.details) ?? err.message)
          : 'Network error. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Left — Form */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
              <Zap className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="text-xl font-bold text-white">SmartRoute AI</span>
          </div>

          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-slate-400">Start optimizing your AI costs today.</p>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-800/50 bg-red-900/20 px-3 py-2.5 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label htmlFor="register-name" className="mb-1.5 block text-sm font-medium text-slate-300">Full name</label>
                <input
                  id="register-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={update('name')}
                  placeholder="Jane Smith"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="register-email" className="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
                <input
                  id="register-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={update('email')}
                  placeholder="you@company.com"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="register-password" className="mb-1.5 block text-sm font-medium text-slate-300">Password</label>
                <input
                  id="register-password"
                  type="password"
                  required
                  value={form.password}
                  onChange={update('password')}
                  placeholder="Min. 8 characters"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="register-workspace-name" className="mb-1.5 block text-sm font-medium text-slate-300">
                  Workspace name{' '}
                  <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <input
                  id="register-workspace-name"
                  type="text"
                  aria-label="Workspace name"
                  value={form.workspaceName}
                  onChange={update('workspaceName')}
                  placeholder="My Company"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="register-workspace-slug" className="mb-1.5 block text-sm font-medium text-slate-300">
                  Workspace slug{' '}
                  <span className="font-normal text-slate-500">(optional, for SSO)</span>
                </label>
                <input
                  id="register-workspace-slug"
                  type="text"
                  aria-label="Workspace slug"
                  value={form.workspaceSlug}
                  onChange={update('workspaceSlug')}
                  placeholder="my-company"
                  pattern="[a-z0-9-]+"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Lowercase letters, numbers, and hyphens (3–40 chars). Used for SSO sign-in.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <GoogleOAuthButton label="Sign up with Google" />

          <p className="mt-4 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-blue-400 hover:text-blue-300">
              Sign in
            </Link>
          </p>
        </div>
      </div>

      {/* Right — Feature list */}
      <div className="hidden lg:flex lg:w-[420px] lg:flex-col lg:justify-center lg:border-l lg:border-slate-800 lg:bg-slate-900/50 lg:px-12">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-blue-400">
          What you get
        </p>
        <h2 className="text-2xl font-bold text-white">
          One gateway.
          <br />
          All providers.
          <br />
          Maximum savings.
        </h2>
        <ul className="mt-8 space-y-3">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-3 text-sm text-slate-400">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
              {f}
            </li>
          ))}
        </ul>

        <div className="mt-10 rounded-xl border border-slate-700 bg-slate-800 p-5">
          <p className="text-3xl font-bold text-white">
            $0<span className="text-base font-normal text-slate-400">/mo</span>
          </p>
          <p className="mt-1 text-sm text-slate-400">Free plan · No credit card required</p>
          <p className="mt-3 text-xs text-slate-500">500 requests/day · 1M tokens/day</p>
        </div>
      </div>
    </div>
  );
}
