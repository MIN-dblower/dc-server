/**
 * Adesa auction record interface
 * Based on the Adesa CSV format
 */
export interface AdesaRecord {
  laneRun: string; // Lane / Run
  date: string; // Date
  saleChannel: string; // Sale Channel
  location: string; // Location
  year: number; // Year
  make: string; // Make
  model: string; // Model
  trim: string; // Trim
  vin: string; // VIN (unique identifier)
  engine: string; // Engine
  transmission: string; // Transmission
  drivetrain: string; // Drivetrain
  fuel: string; // Fuel
  exteriorColor: string; // Exterior Color
  odometer: number; // Odometer
  grade: number; // Grade
  conditionGuarantee: string; // Condition Guarantee
  driveability: string; // Driveability
  carValue: string; // CarValue
  seller: string; // Seller
  notes: string; // Notes
  announcements: string; // Announcements
  titleStatus: string; // Title Status
  createdAt?: Date;
  lastUpdatedAt?: Date;
}


