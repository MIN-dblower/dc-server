export interface IVehicle {
  vin: string;
  make: string;
  model: string;
  year: number;
  odometer: number;
  trim: string;
  transmission: string; // Empty string means transmission should be selected randomly
}
