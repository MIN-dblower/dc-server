/**
 * Custom error for when MarketDataBuildMatching API returns null
 */

export class NoVehicleDataError extends Error {
  public readonly vin: string;
  public readonly inventoryId?: string;

  constructor(vin: string, inventoryId?: string) {
    const message = `MarketDataBuildMatching API returned null for VIN ${vin}`;
    super(message);
    this.name = 'NoVehicleDataError';
    this.vin = vin;
    this.inventoryId = inventoryId;
  }
}
