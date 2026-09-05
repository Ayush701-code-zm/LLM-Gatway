'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Workspace {
  id: string;
  slug: string;
  name: string;
  role: string;
}

interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  emailVerified: boolean;
  mfaEnabled?: boolean;
  workspaces: Workspace[];
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  currentWorkspaceId: string | null;

  setAuth: (user: User, accessToken: string, refreshToken: string, workspaceId?: string) => void;
  setCurrentWorkspace: (id: string) => void;
  updateAccessToken: (token: string) => void;
  updateUser: (user: User) => void;
  logout: () => void;
}

export const selectIsAuthenticated = (state: AuthState) =>
  Boolean(state.accessToken && state.user);

export const selectCurrentWorkspace = (state: AuthState): Workspace | null => {
  if (!state.user) return null;
  return (
    state.user.workspaces.find((w) => w.id === state.currentWorkspaceId) ??
    state.user.workspaces[0] ??
    null
  );
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      currentWorkspaceId: null,

      setAuth: (user, accessToken, refreshToken, workspaceId) =>
        set({
          user,
          accessToken,
          refreshToken,
          currentWorkspaceId: workspaceId ?? user.workspaces[0]?.id ?? null,
        }),

      setCurrentWorkspace: (id) => set({ currentWorkspaceId: id }),

      updateAccessToken: (token) => set({ accessToken: token }),

      updateUser: (user) => set({ user }),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, currentWorkspaceId: null }),
    }),
    {
      name: 'smartroute-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        currentWorkspaceId: state.currentWorkspaceId,
      }),
    },
  ),
);

/** Wait for persisted auth state to load from localStorage (client-only). */
export function useAuthHydrated() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const { persist: persistApi } = useAuthStore;
    if (persistApi.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return persistApi.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}
