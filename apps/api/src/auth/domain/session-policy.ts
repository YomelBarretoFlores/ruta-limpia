/** Session lifetime: an idle timeout and an absolute lifetime (OWASP ASVS 3.3). */
export interface SessionPolicy {
  readonly idleMinutes: number;
  readonly absoluteHours: number;
  /** `last_seen_at` is refreshed at most this often, to spare a write per request. */
  readonly touchIntervalSec: number;
}

export interface SessionTimes {
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export type SessionStatus = 'active' | 'revoked' | 'expired' | 'idle_expired';

/** The times of a session opened now. */
export function openSession(now: Date, policy: SessionPolicy): SessionTimes {
  return {
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + policy.absoluteHours * 3_600_000),
    revokedAt: null,
  };
}

export function sessionStatus(
  session: SessionTimes,
  now: Date,
  policy: SessionPolicy,
): SessionStatus {
  if (session.revokedAt !== null) return 'revoked';
  if (now.getTime() >= session.expiresAt.getTime()) return 'expired';
  if (now.getTime() - session.lastSeenAt.getTime() >= policy.idleMinutes * 60_000) {
    return 'idle_expired';
  }
  return 'active';
}

/** True when an active session's `last_seen_at` is old enough to be refreshed. */
export function shouldTouch(session: SessionTimes, now: Date, policy: SessionPolicy): boolean {
  return now.getTime() - session.lastSeenAt.getTime() >= policy.touchIntervalSec * 1000;
}

/** Lifetime left for the cookie `Max-Age`, in whole seconds (never negative). */
export function remainingLifetimeSec(session: SessionTimes, now: Date): number {
  return Math.max(0, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000));
}

export type UserAgentClass = 'mobile' | 'desktop' | 'other';

/**
 * A coarse device class for the session list; the user agent itself is never stored (it is a
 * fingerprinting vector and not needed).
 */
export function classifyUserAgent(userAgent: string | undefined): UserAgentClass | null {
  if (userAgent === undefined || userAgent === '') return null;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return 'mobile';
  if (/Windows|Macintosh|X11|Linux|CrOS/i.test(userAgent)) return 'desktop';
  return 'other';
}
