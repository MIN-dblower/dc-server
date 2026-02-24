import { loadEnvConfig } from '../config/env.config';
import { DCEngine } from '../services/dcengine';
import { sendAPIRequest } from '../class/window';
import { IVehicle } from '../interfaces/vehicle.types';

// Initialize environment configuration
loadEnvConfig();

const TEST_VIN = process.env.TEST_VIN ?? 'REPLACE_ME_VIN';
const TEST_ODOMETER = process.env.TEST_ODOMETER
  ? Number(process.env.TEST_ODOMETER)
  : undefined;
const TEST_INVENTORY_ID: string | null = process.env.TEST_INVENTORY_ID ?? null;
const TEST_MAKE = process.env.TEST_MAKE ?? '';
const TEST_MODEL = process.env.TEST_MODEL ?? '';
const TEST_TRIM = process.env.TEST_TRIM ?? '';
const TEST_YEAR = Number(process.env.TEST_YEAR ?? '0') || 0;

type MarketFilter = { filters: any; vehicleInfo: any };

async function buildMarketFilterForUnregisteredVin(
  dcEngine: DCEngine,
  page: any,
  token: string,
  vin: string,
  odometer: number,
): Promise<MarketFilter> {
  const vehicleForBuild: IVehicle = {
    vin,
    odometer,
    make: TEST_MAKE,
    model: TEST_MODEL,
    year: TEST_YEAR,
    trim: TEST_TRIM,
    transmission: '',
    color: "White",
    grade: 4.6
  };
  const { vehicleBuilds } = await dcEngine.completeVehicleBuild(
    page,
    vehicleForBuild,
  );

  if (!Array.isArray(vehicleBuilds) || vehicleBuilds.length === 0) {
    throw new Error('Unable to build vehicle definition from VIN.');
  }

  const baseBuild = vehicleBuilds[0];
  const vehicleMeta = {
    make: baseBuild.make,
    trim: baseBuild.trim,
    year: baseBuild.year,
    body: baseBuild.bodyType,
    driveTrain: baseBuild.driveTrain,
    fuelType: baseBuild.fuelType,
    modelId: baseBuild.modelIdentifier,
    model: baseBuild.model,
    transmission: baseBuild.transmission,
    engine: baseBuild.engine,
    trimName: baseBuild.trimName,
    equipmentCodes: baseBuild.vehicleEquipments
      ?.filter((el: any) => el.checked)
      .map((el: any) => el.codeDescription),
    equipmentIds: baseBuild.vehicleEquipments
      ?.filter((el: any) => el.checked)
      .map((el: any) => el.code),
  };

  const buildMatchingData = await sendAPIRequest(
    page,
    'https://app.dealercenter.net/api-gateway/inventory/MarketData/MarketDataBuildMatching',
    'POST',
    { Authorization: `Bearer ${token}` },
    {
      marketCompleteMatching: true,
      modelDefinition: {
        book: 1,
        equipment: vehicleMeta.equipmentCodes,
        modelId: vehicleMeta.modelId,
        vehicleInformation: {
          entityID: '00000000-0000-0000-0000-000000000000',
          entityTypeID: 3,
          vin,
          stockNumber: '',
          year: vehicleMeta.year,
          make: vehicleMeta.make,
          model: vehicleMeta.model,
          trim: vehicleMeta.trim,
          odometer,
          body: vehicleMeta.body,
          color: null,
          engine: vehicleMeta.engine,
          transmission: vehicleMeta.transmission,
          driveTrain: vehicleMeta.driveTrain,
          fuelType: vehicleMeta.fuelType,
          modelId: vehicleMeta.modelId,
          vehiclePrice: 0,
          advertisingPrice: 0,
          askingPrice: 0,
          specialPrice: 0,
          specialPriceStartDate: null,
          specialPriceEndDate: null,
          price: 0,
          totalCost: 0,
          certified: null,
          equipment: vehicleMeta.equipmentCodes,
          equipmentIds: vehicleMeta.equipmentIds,
        },
      },
    },
  );

  const optionCollection = buildMatchingData.optionCollection ?? {};
  const mapNames = (items?: any[]) =>
    Array.isArray(items) ? items.map((item: any) => item.name) : [];

  const trims = Array.isArray(optionCollection.trims)
    ? optionCollection.trims
        .map((el: any) => el.name)
        .filter((name: string) => name.toLowerCase() !== 'base')
    : [];

  const filters = {
    bodyStyles: mapNames(optionCollection.bodyStyles),
    driveTrains: mapNames(optionCollection.drivetrains),
    engines: mapNames(optionCollection.engines),
    equipments: [],
    fuelTypes: [],
    geoCoordinate: null,
    isActive: 1,
    isCertified: null,
    longitude: 0,
    latitude: 0,
    modelAggregate: mapNames(optionCollection.models),
    odometerMax: odometer + 15000 || null,
    odometerMin: odometer - 15000 || null,
    packages: [],
    radiusInMiles: 0,
    transmissions: mapNames(optionCollection.transmissions),
    trims,
    yearAdjusment: 0,
    years: [vehicleMeta.year],
    zip: '62298',
  };

  const vehicleInfo = {
    entityID: '00000000-0000-0000-0000-000000000000',
    entityTypeID: 3,
    vin,
    stockNumber: '',
    year: vehicleMeta.year,
    make: vehicleMeta.make,
    model: filters.modelAggregate.length
      ? filters.modelAggregate[0]
      : vehicleMeta.model,
    trim: filters.trims.length ? filters.trims[0] : vehicleMeta.trim,
    odometer,
    body: vehicleMeta.body,
    color: null,
    engine: vehicleMeta.engine,
    transmission: vehicleMeta.transmission,
    driveTrain: vehicleMeta.driveTrain,
    fuelType: vehicleMeta.fuelType,
    modelId: vehicleMeta.modelId,
    vehiclePrice: 0,
    advertisingPrice: 0,
    askingPrice: 0,
    specialPrice: 0,
    specialPriceStartDate: null,
    specialPriceEndDate: null,
    price: 0,
    totalCost: 0,
    certified: null,
    equipment: vehicleMeta.equipmentCodes,
    equipmentIds: vehicleMeta.equipmentIds,
  };

  return { filters, vehicleInfo };
}

async function main(): Promise<void> {
  if (!TEST_VIN || TEST_VIN === 'REPLACE_ME_VIN') {
    throw new Error(
      'Update TEST_VIN in src/scripts/test-adjust-filters.ts (or set TEST_VIN env) before running.',
    );
  }

  console.log(
    `[AdjustFiltersTest] Starting test for VIN=${TEST_VIN} ` +
      `(strategy=weighted)`,
  );

  const dcEngine = new DCEngine();
  const page = await dcEngine.openScraper();

  try {
    const token = await dcEngine.getToken(page);
    if (!token) {
      throw new Error(
        'Failed to retrieve DealerCenter token. Ensure refresh token is valid.',
      );
    }

    let inventoryId: string | null | undefined = TEST_INVENTORY_ID ?? undefined;
    if (!inventoryId) {
      console.log('[AdjustFiltersTest] Looking up inventory ID by VIN...');
      inventoryId = await dcEngine.getInventoryByVin(page, TEST_VIN);
    }

    let marketFilter: MarketFilter;
    if (inventoryId) {
      console.log(
        `[AdjustFiltersTest] Using inventoryId=${inventoryId} to fetch market price filter`,
      );
      marketFilter = await dcEngine.getMarketPriceFilter(page, inventoryId);
      if (TEST_ODOMETER) {
        marketFilter.vehicleInfo.odometer = TEST_ODOMETER;
      }
    } else {
      if (!TEST_ODOMETER) {
        throw new Error(
          'Set TEST_ODOMETER (env or script) before testing unregistered vehicles.',
        );
      }
      console.log(
        '[AdjustFiltersTest] VIN is not in inventory; building draft market filter from VIN...',
      );
      marketFilter = await buildMarketFilterForUnregisteredVin(
        dcEngine,
        page,
        token,
        TEST_VIN,
        TEST_ODOMETER,
      );
    }

    console.log(
      `[AdjustFiltersTest] Initial radius=${marketFilter.filters.radiusInMiles}, ` +
        `odometer=${marketFilter.filters.odometerMin ?? 'null'}-${marketFilter
          .filters.odometerMax ?? 'null'}`,
    );

    const { filters, marketLookupData } = await dcEngine.adjustFilters(
      page,
      marketFilter.filters,
      marketFilter.vehicleInfo,
    );

    const listingCount = marketLookupData.marketDaysSupplyResponse.matching;

    console.log(
      '[AdjustFiltersTest] ✅ Completed.\n' +
        `  Strategy: weighted\n` +
        `  Final radius: ${filters.radiusInMiles}\n` +
        `  Final odometer range: ${filters.odometerMin ??
          'null'} - ${filters.odometerMax ?? 'null'}\n` +
        `  isActive: ${filters.isActive ?? 0}\n` +
        `  Transmissions: ${
          Array.isArray(filters.transmissions)
            ? filters.transmissions.join(', ')
            : 'n/a'
        }\n` +
        `  Total comps: ${listingCount}`,
    );
  } catch (error) {
    console.error('[AdjustFiltersTest] ❌ Failed to adjust filters.', error);
    process.exitCode = 1;
  } finally {
    await dcEngine.window.disconnect();
  }
}

void main();
