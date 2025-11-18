/**
 * Custom error for uncovered cases in vehicle build process
 */

export class UncoveredCaseError extends Error {
  public readonly vin: string;
  public readonly question: any;
  public readonly vehicleTrim?: string;

  constructor(vin: string, question: any, vehicleTrim?: string) {
    const message = `Uncovered case for VIN ${vin}: question key="${question.key}", type="${question.type}"`;
    super(message);
    this.name = 'UncoveredCaseError';
    this.vin = vin;
    this.question = question;
    this.vehicleTrim = vehicleTrim;
  }
}

