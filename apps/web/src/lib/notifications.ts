/** Notify header bell (and other listeners) to refetch unread count. */
export function dispatchNotificationsChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('smartroute:notifications-changed'));
  }
}
