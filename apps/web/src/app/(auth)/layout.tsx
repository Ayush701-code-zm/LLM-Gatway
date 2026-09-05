'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';

/** Auth pages that should bounce logged-in users to the app home. */
const REDIRECT_WHEN_AUTHENTICATED = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
]);

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (accessToken && REDIRECT_WHEN_AUTHENTICATED.has(pathname)) {
      router.replace('/dashboard');
    }
  }, [accessToken, pathname, router]);

  return <>{children}</>;
}
