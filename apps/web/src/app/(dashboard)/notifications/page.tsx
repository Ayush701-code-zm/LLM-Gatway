'use client';

import { useState, useCallback } from 'react';
import {
  Bell, CheckCheck, Loader2, ChevronLeft, ChevronRight,
  AlertTriangle, DollarSign, Activity, Shield, Link2,
} from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import { notificationsApi, type NotificationRecord } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { relativeTime } from '@/lib/utils';
import { dispatchNotificationsChanged } from '@/lib/notifications';

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'muted' | 'default';

const TYPE_STYLES: Record<string, { variant: BadgeVariant; icon: React.ReactNode }> = {
  BUDGET_WARNING:       { variant: 'warning', icon: <DollarSign className="h-4 w-4" /> },
  BUDGET_CRITICAL:      { variant: 'danger',  icon: <DollarSign className="h-4 w-4" /> },
  BUDGET_EXCEEDED:      { variant: 'danger',  icon: <DollarSign className="h-4 w-4" /> },
  PROVIDER_DOWN:        { variant: 'danger',  icon: <Activity className="h-4 w-4" /> },
  PROVIDER_DEGRADED:    { variant: 'warning', icon: <Activity className="h-4 w-4" /> },
  PROVIDER_RECOVERED:   { variant: 'success', icon: <Activity className="h-4 w-4" /> },
  CIRCUIT_BREAKER_OPEN: { variant: 'danger',  icon: <Shield className="h-4 w-4" /> },
  CIRCUIT_BREAKER_CLOSED: { variant: 'success', icon: <Shield className="h-4 w-4" /> },
  RATE_LIMIT_EXCEEDED:  { variant: 'warning', icon: <AlertTriangle className="h-4 w-4" /> },
  ANOMALY_DETECTED:     { variant: 'warning', icon: <AlertTriangle className="h-4 w-4" /> },
  API_KEY_EXPIRING:     { variant: 'info',    icon: <Shield className="h-4 w-4" /> },
  WORKSPACE_SLUG_CHANGED: { variant: 'info', icon: <Link2 className="h-4 w-4" /> },
};

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: NotificationRecord;
  onMarkRead: (id: string) => void;
}) {
  const style = TYPE_STYLES[notification.type] ?? {
    variant: 'muted' as BadgeVariant,
    icon: <Bell className="h-4 w-4" />,
  };
  const isUnread = !notification.readAt;

  return (
    <div
      className={`flex items-start gap-4 border-b border-slate-800/50 px-5 py-4 transition-colors ${
        isUnread ? 'bg-blue-950/10' : 'hover:bg-slate-800/20'
      }`}
    >
      <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
        isUnread ? 'bg-blue-900/40 text-blue-400' : 'bg-slate-800 text-slate-500'
      }`}>
        {style.icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${isUnread ? 'text-white' : 'text-slate-300'}`}>
            {notification.title}
          </span>
          <Badge variant={style.variant}>
            {notification.type.replace(/_/g, ' ').toLowerCase()}
          </Badge>
          {isUnread && (
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" title="Unread" />
          )}
        </div>
        <p className="mt-1 text-sm text-slate-400">{notification.body}</p>
        <p className="mt-1.5 text-xs text-slate-600">{relativeTime(notification.createdAt)}</p>
      </div>

      {isUnread && (
        <button
          onClick={() => onMarkRead(notification.id)}
          title="Mark as read"
          data-testid={`notification-mark-read-${notification.id}`}
          className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-emerald-400"
        >
          <CheckCheck className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const notifications = useApi(
    useCallback((t) => notificationsApi.list(t, page, unreadOnly), [page, unreadOnly]),
  );

  const unreadCount = useApi(useCallback((t) => notificationsApi.unreadCount(t), []));

  const markReadMutation = useMutation(
    useCallback((t: string, id: string) => notificationsApi.markRead(t, id), []),
  );

  const markAllMutation = useMutation(
    useCallback((t: string, _v: null) => notificationsApi.markAllRead(t), []),
  );

  async function handleMarkRead(id: string) {
    await markReadMutation.mutate(id);
    notifications.refetch();
    unreadCount.refetch();
    dispatchNotificationsChanged();
  }

  async function handleMarkAllRead() {
    await markAllMutation.mutate(null);
    notifications.refetch();
    unreadCount.refetch();
    dispatchNotificationsChanged();
  }

  const pagination = notifications.data?.pagination;
  const unread = unreadCount.data?.count ?? 0;
  const rows = notifications.data?.data ?? [];
  const visibleRows = unreadOnly ? rows.filter((n) => !n.readAt) : rows;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Budget alerts, anomaly detections, and provider status updates
            {unread > 0 && (
              <span className="ml-2 rounded-full bg-blue-900/50 px-2 py-0.5 text-xs text-blue-300">
                {unread} unread
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={unreadOnly ? 'primary' : 'outline'}
            size="sm"
            onClick={() => { setUnreadOnly((v) => !v); setPage(1); }}
            data-testid="notifications-unread-filter"
          >
            {unreadOnly ? 'Showing unread' : 'Show unread only'}
          </Button>
          {unread > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllRead}
              loading={markAllMutation.loading}
              leftIcon={<CheckCheck className="h-3.5 w-3.5" />}
              data-testid="notifications-mark-all-read"
            >
              Mark all read
            </Button>
          )}
        </div>
      </div>

      <Card>
        {notifications.loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        ) : !visibleRows.length ? (
          <div className="p-5">
            <EmptyState
              icon={<Bell className="h-6 w-6" />}
              title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
              description={
                unreadOnly
                  ? 'You are all caught up'
                  : 'Alerts will appear here when budgets are exceeded or anomalies are detected'
              }
            />
          </div>
        ) : (
          <>
            <div>
              {visibleRows.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onMarkRead={handleMarkRead}
                />
              ))}
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3">
                <p className="text-xs text-slate-500">
                  Page {pagination.page} of {pagination.totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={!pagination.hasPrev}
                    leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!pagination.hasNext}
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
