import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, fakeDeps } from '../test/fake-deps';
import { ROUTE } from '../test/fixtures';
import { useCitizenRoute } from './useCitizenRoute';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useCitizenRoute', () => {
  it('retries a failed load with a growing delay until the route arrives', async () => {
    const api = fakeApi();
    api.listRoutes
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const deps = fakeDeps({ api });
    const { result } = renderHook(() => useCitizenRoute(deps, ''));

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(api.listRoutes).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(api.listRoutes).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('unavailable');

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(api.listRoutes).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(api.listRoutes).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('tries again at once when the browser comes back online, or when asked', async () => {
    const api = fakeApi();
    api.listRoutes
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const deps = fakeDeps({ api });
    const { result } = renderHook(() => useCitizenRoute(deps, ''));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(api.listRoutes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));

    const current = result.current;
    act(() => {
      if (current.status === 'unavailable') current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(api.listRoutes).toHaveBeenCalledTimes(3);
  });

  it('tells an empty catalog (no active route) apart from a connection problem', async () => {
    const api = fakeApi();
    api.listRoutes.mockResolvedValue([]);
    const deps = fakeDeps({ api });
    const { result } = renderHook(() => useCitizenRoute(deps, ''));

    await waitFor(() => expect(result.current.status).toBe('no_route'));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.listRoutes).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the route is loaded', async () => {
    const api = fakeApi();
    const deps = fakeDeps({ api });
    const { result, unmount } = renderHook(() => useCitizenRoute(deps, ''));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    unmount();

    expect(api.getRoute).toHaveBeenCalledTimes(1);
    expect(api.getRoute).toHaveBeenCalledWith(ROUTE.code);
  });
});
