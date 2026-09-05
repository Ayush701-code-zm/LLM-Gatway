'use client';

import Link from 'next/link';
import { useCallback, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { notificationsApi } from '@/lib/api';

export function NotificationBell() {
  const pathname = usePathname();
  const unread = useApi(useCallback((t) => notificationsApi.unreadCount(t), []));
  const count = unread.data?.count ?? 0;

  useEffect(() => {
    unread.refetch();
  }, [pathname, unread.refetch]);

  useEffect(() => {
    function onNotificationsChanged() {
      unread.refetch();
    }
    window.addEventListener('smartroute:notifications-changed', onNotificationsChanged);
    return () => window.removeEventListener('smartroute:notifications-changed', onNotificationsChanged);
  }, [unread.refetch]);

  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';

  return (
    <Link
      href="/notifications"
      data-testid="notification-bell"
      aria-label={label}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
      title={label}
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span
          data-testid="notification-badge"
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
