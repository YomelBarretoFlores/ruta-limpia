import type { PushService } from './push-service';

/** The proof of this browser's alert subscription that a usage view carries. */
export interface ViewCredentials {
  readonly subscriptionId: string;
  readonly managementToken: string;
}

/**
 * Reads the proof for a usage view from the push service (which also knows credentials kept in
 * memory). Never rejects: without a readable subscription the view is simply anonymous.
 */
export function viewCredentialsOf(
  push: Pick<PushService, 'current'>,
): () => Promise<ViewCredentials | null> {
  return async () => {
    try {
      const current = await push.current();
      return current === null
        ? null
        : { subscriptionId: current.subscriptionId, managementToken: current.managementToken };
    } catch {
      return null;
    }
  };
}
