import crypto from 'crypto';

type MarginRange = {
  min: number;
  max: number | null; // Use `null` for open-ended ranges
  margin: number;
};
const marginRanges: MarginRange[] = [
  { min: 0, max: 5000, margin: 1800 },
  { min: 5001, max: 10000, margin: 2000 },
  { min: 10001, max: 20000, margin: 2500 },
  { min: 20001, max: 30000, margin: 2750 },
  { min: 30001, max: 40000, margin: 3000 },
  { min: 40001, max: 50000, margin: 3500 },
  { min: 50001, max: 70000, margin: 4000 },
  { min: 70001, max: null, margin: 5000 }, // `null` for open-ended range
];

export function getMarginPrice(value: number, ranges = marginRanges): number {
  for (const range of ranges) {
    if (range.min <= value && (range.max === null || value <= range.max)) {
      return range.margin;
    }
  }
  throw new Error('Value does not fall within any range');
}

export function getJustBelowNearestThousand(value: number) {
  return Math.floor(value / 1000) * 1000 - 2;
}

type MileageRange = {
  min: number;
  max: number | null; // Use `null` for open-ended ranges
  price: number;
};

const mileageRanges: MileageRange[] = [
  { min: 0, max: 25000, price: 175 },
  { min: 25001, max: 50000, price: 275 },
  { min: 50001, max: 75000, price: 375 },
  { min: 75001, max: null, price: 500 }, // `null` for open-ended range
];

export function getPriceByMileage(
  mileage: number,
  ranges = mileageRanges,
): number {
  for (const range of ranges) {
    if (range.min <= mileage && (range.max === null || mileage <= range.max)) {
      return range.price;
    }
  }
  throw new Error('Mileage does not fall within any range');
}
export function getSumOfNumbersInDollars(input: string): number {
  const matches = input.match(/\$\$(\d+)\$\$/g); // Match all occurrences of $$<number>$$
  if (!matches) {
    return 0; // Return 0 if no matches are found
  }
  return matches
    .map(match => parseInt(match.replace(/\$\$/g, ''), 10)) // Remove $$ and convert to number
    .reduce((sum, num) => sum + num, 0); // Sum up all the numbers
}
type BuyerFeeRange = {
  max: number | null; // Use `null` for open-ended ranges
  fee: number;
};

const buyerFeeRanges: BuyerFeeRange[] = [
  { max: 499, fee: 130 },
  { max: 999, fee: 175 },
  { max: 1199, fee: 220 },
  { max: 1599, fee: 250 },
  { max: 1999, fee: 255 },
  { max: 2499, fee: 315 },
  { max: 2899, fee: 350 },
  { max: 3499, fee: 355 },
  { max: 3999, fee: 365 },
  { max: 4799, fee: 385 },
  { max: 5699, fee: 400 },
  { max: 6749, fee: 410 },
  { max: 7999, fee: 435 },
  { max: 9499, fee: 440 },
  { max: 11399, fee: 455 },
  { max: 13499, fee: 465 },
  { max: 15999, fee: 500 },
  { max: 19299, fee: 530 },
  { max: 21999, fee: 545 },
  { max: 24399, fee: 565 },
  { max: 26999, fee: 605 },
  { max: 29999, fee: 735 },
  { max: 39999, fee: 765 },
  { max: 49999, fee: 795 },
  { max: 74999, fee: 805 },
  { max: 99999, fee: 1075 },
  { max: 149999, fee: 1135 },
  { max: 300000, fee: 1195 },
];

export function getAdesaFee(price: number, ranges = buyerFeeRanges): number {
  for (const range of ranges) {
    if (range.max === null || price <= range.max) {
      const index = ranges.indexOf(range);
      if (index === 0) return 50;
      return 50 + ranges[index - 1].fee;
    }
  }
  throw new Error('Price does not fall within any range');
}
export function getEdgePipelineFee(appraisalValue: number): number {
  return appraisalValue * 0.02 + 250;
}
type RankItem = {
  rank: number;
  count: number;
  price: number;
};

export function getRank(value: number, ranks: RankItem[]): number {
  for (const rankItem of ranks) {
    if (value < rankItem.price) {
      return rankItem.rank; // Return the rank where the price is just above the value
    }
  }
  return ranks.length; // If value is higher than all prices, return the lowest rank
}

export function generateId(): string {
  const rnds = crypto.randomBytes(16);

  // Per RFC 4122: set version to 4 ---- bits 12-15 of time_hi_and_version
  rnds[6] = (rnds[6] & 0x0f) | 0x40;

  // Per RFC 4122: set variant to RFC 4122 ---- bits 6-7 of clock_seq_hi_and_reserved
  rnds[8] = (rnds[8] & 0x3f) | 0x80;

  // Convert to UUID string: 8-4-4-4-12
  const hex = rnds.toString('hex');
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(
    12,
    16,
  )}-${hex.substring(16, 20)}-${hex.substring(20)}`;
}
