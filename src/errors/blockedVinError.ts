/**
 * Custom error for when a VIN is blocked and job should be paused
 * This error should not trigger retries - the job should be paused instead
 */

export class BlockedVinError extends Error {
  public readonly vin: string;
  public readonly reason: string;

  constructor(vin: string, reason: string) {
    const message = `VIN ${vin} is blocked: ${reason}. Job has been paused.`;
    super(message);
    this.name = 'BlockedVinError';
    this.vin = vin;
    this.reason = reason;
  }
}

