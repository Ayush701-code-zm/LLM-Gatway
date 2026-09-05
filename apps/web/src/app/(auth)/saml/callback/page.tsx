'use client';

import { Suspense } from 'react';
import { AuthCallbackHandler } from '@/components/auth/AuthCallbackHandler';

export default function SamlCallbackPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <AuthCallbackHandler
        mfaDescription="Complete SSO sign-in with your authenticator code"
        loadingMessage="Completing SSO sign-in…"
        errorCode="saml_failed"
      />
    </Suspense>
  );
}
