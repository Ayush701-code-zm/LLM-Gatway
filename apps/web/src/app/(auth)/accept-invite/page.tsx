'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { memberApi, SmartRouteApiError } from '@/lib/api';
import { selectIsAuthenticated, useAuthHydrated, useAuthStore } from '@/store/auth';

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useAuthHydrated();
  const token = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const inviteToken = searchParams.get('token');
    if (!inviteToken) {
      setStatus('error');
      setMessage('Missing invite token.');
      return;
    }

    if (!hydrated) return;

    if (!isAuthenticated || !token) {
      router.replace(`/login?redirect=${encodeURIComponent(`/accept-invite?token=${inviteToken}`)}`);
      return;
    }

    setStatus('loading');
    memberApi
      .acceptInvite(token, inviteToken)
      .then((result) => {
        setAuth(result.user, result.tokens.accessToken, result.tokens.refreshToken, result.workspaceId);
        setStatus('success');
        setMessage('You have joined the workspace. Redirecting…');
        setTimeout(() => router.push('/team'), 2000);
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof SmartRouteApiError ? err.message : 'Failed to accept invite');
      });
  }, [searchParams, token, isAuthenticated, hydrated, router, setAuth]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-400" />
            <p className="mt-4 text-slate-300">Accepting invitation…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="mx-auto h-10 w-10 text-emerald-400" />
            <p className="mt-4 text-white">{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle className="mx-auto h-10 w-10 text-red-400" />
            <p className="mt-4 text-red-300">{message}</p>
            <Link href="/login" className="mt-6 inline-block text-sm text-blue-400 hover:underline">
              Sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <AcceptInviteContent />
    </Suspense>
  );
}
