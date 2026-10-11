import { describe, expect, it } from 'vitest';

import { fakePush } from '../test/fake-deps';
import { viewCredentialsOf } from './view-credentials';

describe('viewCredentialsOf', () => {
  it('gives the id and the token of the current subscription, and nothing else', async () => {
    const push = fakePush();
    push.current.mockResolvedValue({
      subscriptionId: 'sub-1',
      managementToken: 'token-1',
      pointCode: 'P08',
      routeCode: 'RI-01',
    });

    expect(await viewCredentialsOf(push)()).toEqual({
      subscriptionId: 'sub-1',
      managementToken: 'token-1',
    });
  });

  it('never rejects: a failing read gives an anonymous view', async () => {
    const push = fakePush();
    push.current.mockRejectedValue(new Error('IndexedDB unavailable'));

    await expect(viewCredentialsOf(push)()).resolves.toBeNull();
  });
});
