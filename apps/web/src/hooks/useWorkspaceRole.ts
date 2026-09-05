'use client';

import { selectCurrentWorkspace, useAuthStore } from '@/store/auth';

export function useWorkspaceRole() {
  const currentWorkspace = useAuthStore(selectCurrentWorkspace);
  const role = currentWorkspace?.role ?? 'VIEWER';

  return {
    role,
    canWrite: role !== 'VIEWER',
    canAdmin: role === 'OWNER' || role === 'ADMIN',
    isOwner: role === 'OWNER',
  };
}
