import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeDeps } from '../test/fake-deps';
import { useViewReporting } from './useViewReporting';

let visibility: DocumentVisibilityState = 'visible';
const visibilitySpy = vi
  .spyOn(document, 'visibilityState', 'get')
  .mockImplementation(() => visibility);

afterEach(() => {
  visibility = 'visible';
});

function becomeVisible() {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useViewReporting', () => {
  it('reports again when the page becomes visible, at most once every 5 minutes', async () => {
    let now = 0;
    const deps = fakeDeps({ now: () => now });
    renderHook(() => useViewReporting(deps, 'RI-01', 'P08'));
    await waitFor(() => expect(deps.api.recordView).toHaveBeenCalledTimes(1));

    now = 60_000;
    becomeVisible();
    now = 5 * 60_000;
    becomeVisible();

    await waitFor(() => expect(deps.api.recordView).toHaveBeenCalledTimes(2));
    expect(visibilitySpy).toHaveBeenCalled();
  });

  it('keeps the throttle when the point changes and reports the new point', async () => {
    let now = 0;
    const deps = fakeDeps({ now: () => now });
    const initialProps: { point: string | null } = { point: 'P08' };
    const { rerender } = renderHook(
      ({ point }: { point: string | null }) => useViewReporting(deps, 'RI-01', point),
      { initialProps },
    );
    await waitFor(() => expect(deps.api.recordView).toHaveBeenCalledTimes(1));

    rerender({ point: null });
    rerender({ point: 'P09' });
    now = 60_000;
    becomeVisible();
    await Promise.resolve();
    expect(deps.api.recordView).toHaveBeenCalledTimes(1);

    now = 6 * 60_000;
    becomeVisible();
    await waitFor(() =>
      expect(deps.api.recordView).toHaveBeenLastCalledWith({
        pointCode: 'P09',
        routeCode: 'RI-01',
      }),
    );
  });

  it('stops listening once the page is gone', async () => {
    let now = 0;
    const deps = fakeDeps({ now: () => now });
    const { unmount } = renderHook(() => useViewReporting(deps, 'RI-01', 'P08'));
    await waitFor(() => expect(deps.api.recordView).toHaveBeenCalledTimes(1));

    unmount();
    now = 60 * 60_000;
    becomeVisible();
    await Promise.resolve();

    expect(deps.api.recordView).toHaveBeenCalledTimes(1);
  });

  it('still reports the view when the subscription proof cannot be read', async () => {
    const deps = fakeDeps({ viewCredentials: () => Promise.reject(new Error('IndexedDB')) });

    renderHook(() => useViewReporting(deps, 'RI-01', 'P08'));

    await waitFor(() =>
      expect(deps.api.recordView).toHaveBeenCalledWith({ pointCode: 'P08', routeCode: 'RI-01' }),
    );
  });
});
