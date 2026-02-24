import { IVehicle } from '@interfaces/vehicle.types';
import { DCEngine } from '@services/dcengine';
import {
  getAdesaFee,
  getJustBelowNearestThousand,
  getMarginPrice,
  getPriceByMileage,
  getRank,
  getSumOfNumbersInDollars,
  recordToVehicle,
} from '@utils/auction';


const onUpdateOdometor = async () => {
  const dcEngine = new DCEngine();
  const record: IVehicle = {
    vin: '2C3CCABG0EH373289',
    make: 'Chrysler',
    model: '300',
    year: 2014,
    odometer: 557073,
    trim: 'Limited',
    transmission: '',
    color: 'White',
    grade: 4.5,
  };
  const watchNote =
    '*** MS *** NC *** PDR - $$225$$ *** CONSOLE TRIM $$125$$ *** DROVE GOOD';
  const page = await dcEngine.openScraper();
  const token = await dcEngine.getToken(page);
  if (!token) {
    console.error('Failed to retrieve token.');
    return;
  }
  dcEngine.setToken(token);
  const inventoryId = await dcEngine.getInventoryByVin(page, record.vin);
  if (!inventoryId) {
    console.error('Inventory not found for VIN:', record.vin);
    return;
  }
  const inventoryDetail = await dcEngine.getInventoryDetails(
    page,
    inventoryId!,
  );
  const kbbBuild = inventoryDetail.vehicleBuilds.find(
    (el: any) => el.bookServiceTypeId === 1,
  );
  const vehicleBuilds = inventoryDetail.vehicleBuilds;
  const vehicleMeta = {
    year: kbbBuild.year,
    make: kbbBuild.make,
    model: kbbBuild.model,
    trim: kbbBuild.trim,
  };
  const valuation = await dcEngine.getInventoryValuation(
    page,
    record,
    vehicleMeta,
    vehicleBuilds,
  );
  const marketPriceFilter = await dcEngine.getMarketPriceFilter(
    page,
    inventoryId,
  );
  const { filters, vehicleInfo, id, companyId } = marketPriceFilter;
  vehicleInfo.odometer = record.odometer;
  console.log(filters);
  const {
    filters: adjustedFilters,
    marketLookupData,
  } = await dcEngine.adjustFilters(page, filters, vehicleInfo);
  const {
    priceAvg: price,
    minPrice,
    maxPrice,
    matching,
    avgOdometer,
    vehicleCount,
  } = await dcEngine.getMarketPrice(page, adjustedFilters, vehicleInfo);
  const askingPrice = getJustBelowNearestThousand(price);
  const marginPrice = getMarginPrice(askingPrice);
  const itemCost = getSumOfNumbersInDollars(watchNote);
  const reconCost = getPriceByMileage(record.odometer) + itemCost + 110 + 125;
  const lotFee = 500;
  const appraisalValue = askingPrice - reconCost - marginPrice - lotFee;
  const buyerFee = getAdesaFee(appraisalValue);

  const additionalFee = buyerFee + lotFee;
  const currentAppraisalValue = appraisalValue - buyerFee;

  console.log(`Price Analysis for VIN: ${record.vin}`);
  console.log(`- Market Price: $${price}`);
  console.log(`- Asking Price: $${askingPrice}`);
  console.log(`- Margin Price: $${marginPrice}`);
  console.log(`- Recon Cost: $${reconCost}`);
  console.log(`- Appraisal Value: $${appraisalValue}`);
  console.log(`- Buyer Fee: $${buyerFee}`);
  // Update note
  await dcEngine.saveNote(page, inventoryId, watchNote);

  // TODO: Add logic to update odometer and recalculate appraisal
  // TODO: Update market pricing if odometer change affects pricing
  const ranking = await dcEngine.getPriceRanking(
    page,
    adjustedFilters,
    vehicleInfo,
    vehicleCount,
  );

  const rank = getRank(askingPrice, ranking);
  const maxRank = ranking.length;
  const marketPricingID = await dcEngine.getMarketPricingID(page, inventoryId!);
  const marketPricingDetailUpdate = {
    entityId: inventoryId!,
    entityTypeId: 3,
    marketPricingID: id,
    marketPriceFilterID: marketPricingID,
    avgOdometer,
    avgPrice: price,
    minPrice,
    maxPrice,
    marketPrice: askingPrice,
    marketDaySupply: matching,
    matchedVehicleCount: vehicleCount,
    overallVehicleCount: vehicleCount,
    rank,
    maxRank,
    totalGrossProfit: marginPrice,
    reconEstimate: 0,
    appraisedBy: '08ff48cb-f0c7-4bff-8b66-8d069128d879',
    appraisedByName: 'Appraisal Manager - appraisalmanager',
    marketDataProviderID: 1,
  };
  const inventoryFees = inventoryDetail.inventoryAdditionalFees as Array<any>;
  inventoryFees.forEach(fee => {
    if (fee.feeCategoryId === 1) {
      fee.feeAmount = buyerFee;
    } else if (fee.feeCategoryId === 2) {
      fee.feeAmount = lotFee;
    }
  });
  const inventoryUpdate = {
    ...inventoryDetail,
    vehicleBuilds: [
      valuation.kelleyBuild,
      valuation.nadaBuild,
      valuation.blackBookBuild,
      valuation.manheimBuild,
    ],
    totalAdditionalFees: additionalFee,
    lotFee: lotFee,
    buyersFee: buyerFee,
    totalCost: additionalFee,
    odometer: record.odometer,
    reconCost: reconCost,
    targetGrossProfit: marginPrice,
    currentAppraisalValue,
    inventoryAdditionalFees: inventoryFees,
  };
  await dcEngine.saveMarketPricingDetail(page, marketPricingDetailUpdate);
  await dcEngine.saveInventoryDetails(
    page,
    inventoryUpdate,
    inventoryId,
    companyId,
    id,
    adjustedFilters,
    vehicleInfo,
  );
  console.log(
    `⚠️  Placeholder update completed for VIN: ${record.vin} - Full update logic pending`,
  );
};
onUpdateOdometor();
