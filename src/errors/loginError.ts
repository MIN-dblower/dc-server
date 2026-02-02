/**
 * Custom error for when login fails after maximum retries
 */

export class LoginError extends Error {
  public readonly vin?: string;
  public readonly attempts: number;
  public readonly maxAttempts: number;

  constructor(vin: string | undefined, attempts: number, maxAttempts: number) {
    const message = `Login failed after ${attempts} attempts (max: ${maxAttempts})${vin ? ` for VIN ${vin}` : ''}`;
    super(message);
    this.name = 'LoginError';
    this.vin = vin;
    this.attempts = attempts;
    this.maxAttempts = maxAttempts;
  }
}
