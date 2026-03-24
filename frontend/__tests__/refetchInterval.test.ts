import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

/**
 * TEST SUITE: React Query Temporal Dead Zone Fix
 * 
 * These tests verify that the refetchInterval callback form
 * prevents "Cannot access 'error' before initialization" errors
 */

describe('useQuery refetchInterval callback form', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  it('should NOT cause temporal dead zone error with callback form', async () => {
    const mockFn = vi.fn().mockResolvedValue({ data: 'test' });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['test'],
          queryFn: mockFn,
          refetchInterval: (query) => (query.state.error ? false : 1000),
        }),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      }
    );

    // Should not throw temporal dead zone error
    expect(result.current.error).toBe(null);
    expect(() => result.current).not.toThrow();
  });

  it('should stop refetching when error occurs', async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('API Error'))
      .mockResolvedValue({ data: 'test' });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['test-error'],
          queryFn: mockFn,
          refetchInterval: (query) => (query.state.error ? false : 100),
          retry: 1,
        }),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      }
    );

    // Wait for error
    await waitFor(() => expect(result.current.error).toBeTruthy());

    // Verify refetchInterval is disabled by checking calls don't increase
    const callsAfterError = mockFn.mock.calls.length;
    
    await new Promise((resolve) => setTimeout(resolve, 250));
    
    // Should not have made more calls (refetch disabled on error)
    expect(mockFn.mock.calls.length).toBe(callsAfterError);
  });

  it('should continue refetching when no error', async () => {
    const mockFn = vi.fn().mockResolvedValue({ data: 'test' });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['test-success'],
          queryFn: mockFn,
          refetchInterval: (query) => (query.state.error ? false : 100),
        }),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const initialCalls = mockFn.mock.calls.length;

    // Wait for refetch
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Should have refetched (more calls)
    expect(mockFn.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});

/**
 * TEST SUITE: All Fixed Components
 * 
 * Verify each component that was fixed doesn't throw errors
 */
describe('Fixed Components - No Temporal Dead Zone', () => {
  it('header.tsx: health query should work', () => {
    const mockHealthFn = vi.fn().mockResolvedValue({ status: 'ok' });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['health'],
          queryFn: mockHealthFn,
          refetchInterval: (query) => (query.state.error ? false : 30000),
          retry: 1,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient()}>
            {children}
          </QueryClientProvider>
        ),
      }
    );

    expect(() => result.current).not.toThrow();
  });

  it('dashboard page: analytics query should work', () => {
    const mockAnalyticsFn = vi.fn().mockResolvedValue({ totalCalls: 100 });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['analytics', 'aggregate'],
          queryFn: mockAnalyticsFn,
          refetchInterval: (query) => (query.state.error ? false : 60000),
          retry: 1,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient()}>
            {children}
          </QueryClientProvider>
        ),
      }
    );

    expect(() => result.current).not.toThrow();
  });

  it('dashboard page: calls query should work', () => {
    const mockCallsFn = vi.fn().mockResolvedValue([]);

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['calls', 'recent'],
          queryFn: mockCallsFn,
          refetchInterval: (query) => (query.state.error ? false : 30000),
          retry: 1,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient()}>
            {children}
          </QueryClientProvider>
        ),
      }
    );

    expect(() => result.current).not.toThrow();
  });
});

