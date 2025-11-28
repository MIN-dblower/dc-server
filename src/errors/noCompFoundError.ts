/**
 * Custom error for when no similar vehicles (comps) are found in DC
 */

export class NoCompFoundError extends Error {
  public readonly vin: string;
  public readonly vehicleCount: number;
  public readonly inventoryId?: string;

  constructor(vin: string, vehicleCount: number, inventoryId?: string) {
    const message = `No similar vehicles found for VIN ${vin}. Vehicle count: ${vehicleCount}`;
    super(message);
    this.name = 'NoCompFoundError';
    this.vin = vin;
    this.vehicleCount = vehicleCount;
    this.inventoryId = inventoryId;
  }
}

