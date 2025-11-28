/**
 * Custom error for transmission selection in Edge Pipeline vehicles
 */

export class TransmissionSelectionError extends Error {
  public readonly vin: string;
  public readonly question: any;
  public readonly vehicleTrim?: string;
  public readonly auctionType: 'Adesa' | 'Edge Pipeline';
  public readonly selectedTransmission: {
    id: string;
    name: string;
  };
  public readonly availableOptions: Array<{
    id: string;
    name: string;
  }>;

  constructor(
    vin: string,
    question: any,
    selectedTransmission: { id: string; name: string },
    availableOptions: Array<{ id: string; name: string }>,
    auctionType: 'Adesa' | 'Edge Pipeline',
    vehicleTrim?: string,
  ) {
    const message = `Transmission selection required for Edge Pipeline vehicle VIN ${vin}`;
    super(message);
    this.name = 'TransmissionSelectionError';
    this.vin = vin;
    this.question = question;
    this.vehicleTrim = vehicleTrim;
    this.auctionType = auctionType;
    this.selectedTransmission = selectedTransmission;
    this.availableOptions = availableOptions;
  }
}

