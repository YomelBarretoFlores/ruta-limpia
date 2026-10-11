import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ActivationResult } from '../push/push-service';
import { fakePush } from '../test/fake-deps';
import { activationMessage, useAlertSubscription } from './useAlertSubscription';

const P08 = { routeCode: 'RI-01', pointCode: 'P08', householdCode: null };
const P09 = { routeCode: 'RI-01', pointCode: 'P09', householdCode: null };

describe('useAlertSubscription', () => {
  it('applies a late activation to the browser state, but drops its message when the target changed', async () => {
    const push = fakePush();
    let finish: (result: ActivationResult) => void = () => undefined;
    push.activate.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result, rerender } = renderHook(({ target }) => useAlertSubscription(push, target), {
      initialProps: { target: P08 },
    });
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    act(() => result.current.setConsent(true));
    act(() => result.current.activate());
    rerender({ target: P09 });
    await act(async () => {
      finish({
        status: 'subscribed',
        subscription: {
          subscriptionId: 'sub-1',
          managementToken: 'token-1',
          pointCode: 'P08',
          routeCode: 'RI-01',
        },
      });
      await Promise.resolve();
    });

    expect(result.current.phase).toBe('subscribed');
    expect(result.current.subscription?.pointCode).toBe('P08');
    expect(result.current.message).toBeNull();
  });

  it('ignores an activation that ends after the page is gone', async () => {
    const push = fakePush();
    let finish: (result: ActivationResult) => void = () => undefined;
    push.activate.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result, unmount } = renderHook(() => useAlertSubscription(push, P08));
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.setConsent(true));
    act(() => result.current.activate());

    unmount();
    await act(async () => {
      finish({ status: 'failed' });
      await Promise.resolve();
    });

    expect(result.current.phase).toBe('activating');
  });
});

describe('activationMessage', () => {
  it('explains a subscription the browser could not store', () => {
    expect(activationMessage({ status: 'not_stored' })).toMatchObject({
      tone: 'warn',
      text: expect.stringContaining('no permite guardar los avisos') as unknown,
    });
    expect(
      activationMessage({
        status: 'subscribed',
        stored: false,
        subscription: {
          subscriptionId: 's',
          managementToken: 't',
          pointCode: 'P08',
          routeCode: 'RI-01',
        },
      }),
    ).toMatchObject({
      tone: 'warn',
      text: expect.stringContaining('antes de cerrar esta página') as unknown,
    });
  });
});
