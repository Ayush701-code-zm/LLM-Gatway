'use client';

import { useState } from 'react';
import { AlertCircle, Loader2, Mail } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export function EmailVerificationBanner() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  if (!user || user.emailVerified) return null;

  async function handleResend() {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      await authApi.resendVerification(accessToken);
      setSent(true);
    } catch {
      setError('Could not send verification email.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-4 py-3">
      <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-amber-200">Verify your email</p>
        <p className="mt-0.5 text-xs text-amber-200/70">
          Check your inbox for a verification link. Without SMTP, check API logs for the dev verify URL.
        </p>
        {error && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="h-3 w-3" />
            {error}
          </p>
        )}
        {sent && <p className="mt-1 text-xs text-green-400">Verification email sent.</p>}
      </div>
      <button
        type="button"
        onClick={handleResend}
        disabled={loading}
        className="flex-shrink-0 rounded-lg border border-amber-700/50 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Resend'}
      </button>
    </div>
  );
}
