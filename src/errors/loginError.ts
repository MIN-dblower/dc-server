/**
 * Custom error for when login fails after maximum retries
 */

export class LoginError extends Error {
  public readonly attempts: number;
  public readonly maxAttempts: number;

  constructor(attempts: number, maxAttempts: number) {
    const message = `Login failed after ${attempts} attempts (max: ${maxAttempts})`;
    super(message);
    this.name = 'LoginError';
    this.attempts = attempts;
    this.maxAttempts = maxAttempts;
  }
}
