'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { selectIsAuthenticated, useAuthHydrated, useAuthStore } from '@/store/auth';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { EmailVerificationBanner } from '@/components/dashboard/EmailVerificationBanner';
import { NotificationBell } from '@/components/dashboard/NotificationBell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hydrated = useAuthHydrated();
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (hydrated && !accessToken) {
      router.replace('/login');
    }
  }, [accessToken, hydrated, router]);

  if (!hydrated || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-3">
          <div />
          <div className="flex items-center gap-2">
            <NotificationBell />
            <a
              href="http://localhost:3001/docs"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-medium text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
            >
              API Docs
            </a>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <EmailVerificationBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
