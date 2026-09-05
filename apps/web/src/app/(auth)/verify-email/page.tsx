'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { authApi, SmartRouteApiError } from '@/lib/api';

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid verification link.');
      return;
    }

    setLoading(true);
    authApi
      .verifyEmail(token)
      .then(() => {
        setDone(true);
        setTimeout(() => router.push('/login'), 2500);
      })
      .catch((err) => {
        setError(err instanceof SmartRouteApiError ? err.message : 'Verification failed.');
      })
      .finally(() => setLoading(false));
  }, [token, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">SmartRoute AI</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl backdrop-blur text-center">
          {loading && !done && !error && (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <p>Verifying your email…</p>
            </div>
          )}

          {done && (
            <div className="flex flex-col items-center gap-2 text-green-400">
              <CheckCircle2 className="h-10 w-10" />
              <p className="font-medium">Email verified!</p>
              <p className="text-sm text-slate-400">Redirecting to sign in…</p>
            </div>
          )}

          {error && (
            <>
              <div className="mb-4 flex items-center justify-center gap-2 text-red-400">
                <AlertCircle className="h-5 w-5" />
                <p>{error}</p>
              </div>
              <Link href="/login" className="text-sm text-blue-400 hover:text-blue-300">
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <VerifyEmailForm />
    </Suspense>
  );
}
