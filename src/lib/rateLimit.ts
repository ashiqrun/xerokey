// File: src/lib/rateLimit.ts

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const loginAttempts = new Map<string, RateLimitRecord>();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Checks if an identifier (IP or username) is rate limited.
 * Returns { isLimited: boolean, remainingMs: number }
 */
export function checkLoginRateLimit(key: string): {
  isLimited: boolean;
  remainingMs: number;
  attemptsLeft: number;
} {
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (!record) {
    return { isLimited: false, remainingMs: 0, attemptsLeft: MAX_FAILED_ATTEMPTS };
  }

  if (now > record.resetAt) {
    loginAttempts.delete(key);
    return { isLimited: false, remainingMs: 0, attemptsLeft: MAX_FAILED_ATTEMPTS };
  }

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    return {
      isLimited: true,
      remainingMs: Math.max(0, record.resetAt - now),
      attemptsLeft: 0,
    };
  }

  return {
    isLimited: false,
    remainingMs: Math.max(0, record.resetAt - now),
    attemptsLeft: MAX_FAILED_ATTEMPTS - record.count,
  };
}

/**
 * Records a failed login attempt.
 */
export function recordFailedLogin(key: string): {
  isLimited: boolean;
  remainingMs: number;
  attemptsLeft: number;
} {
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (!record || now > record.resetAt) {
    loginAttempts.set(key, {
      count: 1,
      resetAt: now + LOCKOUT_WINDOW_MS,
    });
    return {
      isLimited: false,
      remainingMs: LOCKOUT_WINDOW_MS,
      attemptsLeft: MAX_FAILED_ATTEMPTS - 1,
    };
  }

  record.count += 1;
  const isLimited = record.count >= MAX_FAILED_ATTEMPTS;

  return {
    isLimited,
    remainingMs: Math.max(0, record.resetAt - now),
    attemptsLeft: Math.max(0, MAX_FAILED_ATTEMPTS - record.count),
  };
}

/**
 * Clears failed login attempts after successful authentication.
 */
export function resetLoginRateLimit(key: string): void {
  loginAttempts.delete(key);
}
