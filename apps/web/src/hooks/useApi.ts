'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import { SmartRouteApiError } from '@/lib/api';
import { firstFieldErrorMessage } from '@smartroute/shared';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Generic hook for data-fetching with auto-token injection.
 */
export function useApi<T>(
  fetcher: (token: string) => Promise<T>,
  deps: unknown[] = [],
): UseApiState<T> {
  const token = useAuthStore((s) => s.accessToken);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestIdRef = useRef(0);

  const fetch = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setData(null);
    setError(null);
    try {
      const result = await fetcherRef.current(token);
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (err instanceof SmartRouteApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ...deps]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

/**
 * Mutation hook (POST/DELETE/PATCH operations).
 */
export function useMutation<TInput, TResult>(
  mutator: (token: string, input: TInput) => Promise<TResult>,
) {
  const token = useAuthStore((s) => s.accessToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<TResult | null> => {
      if (!token) return null;
      setLoading(true);
      setError(null);
      try {
        const result = await mutator(token, input);
        return result;
      } catch (err) {
        if (err instanceof SmartRouteApiError) {
          setError(firstFieldErrorMessage(err.details) ?? err.message);
        } else {
          setError('An unexpected error occurred');
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    [token, mutator],
  );

  return { mutate, loading, error };
}
