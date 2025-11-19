/**
 * Custom error for when no similar vehicles (comps) are found in DC
 */

export class NoCompFoundError extends Error {
  public readonly vin: string;
  public readonly vehicleCount: number;

  constructor(vin: string, vehicleCount: number) {
    const message = `No similar vehicles found for VIN ${vin}. Vehicle count: ${vehicleCount}`;
    super(message);
    this.name = 'NoCompFoundError';
    this.vin = vin;
    this.vehicleCount = vehicleCount;
  }
}

