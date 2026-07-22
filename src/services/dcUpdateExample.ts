/**
 * DC Update Function Implementation
 *
 * This file implements the DC update interface for auction records.
 * Primary keys: odometer and notes (Adesa) / watchNotes (Edge Pipeline)
 *
 * Flow:
 * 1. Check for VIN duplication
 * 2. If nothing appraised yet: Full appraisal flow
 * 3. If already appraised: Update logic (placeholder for now)
 */

import {
  AuctionRecordUnion,
  DCUpdateResult,
  PricingSummary,
  CompFilters,
} from './dcUpdateInterface';
import { DCEngine } from './dcengine';
import { IVehicle } from '../interfaces/vehicle.types';
import {
  getAdesaFee,
  getEdgePipelineFee,
  getJustBelowNearestThousand,
  getMarginPrice,
  getPriceByMileage,
  getRank,
  getSumOfNumbersInDollars,
  recordToVehicle,
} from '../utils/auction';
import { AdesaRecord } from '../interfaces/adesa.types';
import { EdgePipelineRecord } from '../interfaces/edgePipeline.types';
import { Page } from 'puppeteer';
import { isVinBlocked, getBlockedVinDetails, blockVin } from './blockedVins';
import { enqueueTelegramMessage } from './telegramQueue';
import { UncoveredCaseError } from '../errors/uncoveredCaseError';
import { NoCompFoundError } from '../errors/noCompFoundError';
import { NoVehicleDataError } from '../errors/noVehicleDataError';
import { LoginError } from '@errors/loginError';
import { MfaRequiredError } from '@errors/mfaRequiredError';
import { attemptLoginWithRetry } from './dc-auth';
import { getEmailNotificationService } from './emailNotification';
import { getAdesaRecordByVin } from '../storage/adesaDb';
import { getEdgePipelineRecordByVin } from '../storage/db';

// Login retry configuration
const MAX_LOGIN_RETRIES = 3;

/**
 * Determines if a record is an Adesa record
 */
function isAdesaRecord(record: AuctionRecordUnion): record is AdesaRecord {
  return 'laneRun' in record;
}

/**
 * Extracts notes from a record (Adesa or Edge Pipeline)
 */
function getNotes(record: AuctionRecordUnion): string {
  if (isAdesaRecord(record)) {
    return record.notes || '';
  }
  return (record as EdgePipelineRecord).watchNotes || '';
}


interface PrimaryKeySnapshot {
  odometer: number | null;
  note: string;
  grade: number;
  color: string;
}

interface PrimaryKeyChangeContext {
  odometerChanged: boolean;
  notesChanged: boolean;
  gradeChanged: boolean;
  colorChanged: boolean;
}

async function getPreviousPrimaryKeySnapshot(
  record: AuctionRecordUnion,
): Promise<PrimaryKeySnapshot | null> {
  if (isAdesaRecord(record)) {
    const existing = await getAdesaRecordByVin(record.vin);
    if (!existing) {
      return null;
    }
    return {
      odometer: existing.odometer ?? null,
      note: existing.notes || '',
      grade: existing.grade,
      color: existing.exteriorColor,
    };
  }

  const existing = await getEdgePipelineRecordByVin(record.vin);
  if (!existing) {
    return null;
  }

  return {
    odometer: existing.odometer ?? null,
    note: existing.watchNotes || '',
    grade: existing.grade,
    color: existing.color,
  };
}

async function determinePrimaryKeyChanges(
  record: AuctionRecordUnion,
  currentNote: string,
): Promise<PrimaryKeyChangeContext> {
  const snapshot = await getPreviousPrimaryKeySnapshot(record);
  if (!snapshot) {
    console.warn(
      `Unable to load previous primary keys for VIN ${record.vin} - defaulting to full update`,
    );
    const defaultContext = {
      odometerChanged: true,
      notesChanged: true,
      gradeChanged: true,
      colorChanged: true,
    };
    console.log(
      `Primary key change context for VIN ${record.vin}:`,
      defaultContext,
    );
    return defaultContext;
  }

  const context = {
    odometerChanged: snapshot.odometer !== record.odometer,
    notesChanged: snapshot.note !== (currentNote || ''),
    gradeChanged: snapshot.grade !== record.grade,
    colorChanged: snapshot.color !== (isAdesaRecord(record) ?
      record.exteriorColor : record.color)
  };
  console.log(`Primary key change context for VIN ${record.vin}:`, context);
  return context;
}

function buildPricingSummary(params: {
  marketAveragePrice: number;
  askingPrice: number;
  marginPrice: number;
  reconCost: number;
  appraisalValue: number;
  buyerFee: number;
  lotFee: number;
  currentAppraisalValue: number;
}): PricingSummary {
  return {
    marketAveragePrice: params.marketAveragePrice,
    askingPrice: params.askingPrice,
    marginPrice: params.marginPrice,
    reconCost: params.reconCost,
    appraisalValue: params.appraisalValue,
    buyerFee: params.buyerFee,
    lotFee: params.lotFee,
    currentAppraisalValue: params.currentAppraisalValue,
  };
}

/**
 * Extracts comp filter data from the filters object
 */
function extractCompFilters(filters: any): CompFilters {
  return {
    odometerMin: filters.odometerMin ?? null,
    odometerMax: filters.odometerMax ?? null,
    radiusInMiles: filters.radiusInMiles ?? 0,
    years: filters.years ?? [],
    trims: filters.trims ?? [],
  };
}

/**
 * Performs full appraisal flow for a new vehicle
 * Based on the logic in dealercenter.ts
 */
async function performFullAppraisal(
  dcEngine: DCEngine,
  page: Page,
  record: AuctionRecordUnion,
  note: string,
  type: 'Adesa' | 'Edge Pipeline',
): Promise<DCUpdateResult> {
  const vehicle = recordToVehicle(record);

  // Check if inventory exists, register if not
  let inventoryId = await dcEngine.getInventoryByVin(page, vehicle.vin);
  if (!inventoryId) {
    console.log(`Registering new inventory for VIN: ${vehicle.vin}`);
    const registerResult = await dcEngine.registerInventory(page, vehicle);
    if (!registerResult?.isCompleted) {
      return {
        success: false,
        error: registerResult?.error || 'Failed to register inventory',
      };
    }

    // Handle auto selection notification if present
    if (registerResult.autoSelection) {
      const { autoSelection } = registerResult;
      const selectionType =
        autoSelection.key === 'transmission'
          ? 'Transmission'
          : autoSelection.key === 'trim'
            ? 'Trim'
            : autoSelection.key.charAt(0).toUpperCase() +
            autoSelection.key.slice(1);

      console.log(
        `⚠️  ${selectionType} auto-selected for Edge Pipeline vehicle VIN ${autoSelection.vin
        }: ${autoSelection.selectedOption.name}${autoSelection.inventoryId
          ? ` (Inventory ID: ${autoSelection.inventoryId})`
          : ''
        }`,
      );

      // Notify via Telegram
      try {
        await enqueueTelegramMessage({
          type: 'auto_selection_mode',
          vin: autoSelection.vin,
          vehicleTrim: autoSelection.vehicleTrim,
          details: {
            key: autoSelection.key,
            message: `${selectionType} automatically selected for vehicle without ${autoSelection.key} info`,
            selectedOption: autoSelection.selectedOption,
            availableOptions: autoSelection.availableOptions,
            auctionType: type,
            inventoryId: autoSelection.inventoryId,
          },
        });
      } catch (telegramError) {
        console.error('Failed to queue Telegram notification:', telegramError);
      }

      // Notify via Email
      try {
        const emailService = getEmailNotificationService();
        await emailService.sendTransmissionSelectionNotification({
          vin: autoSelection.vin,
          selectedTransmission: autoSelection.selectedOption,
          availableOptions: autoSelection.availableOptions,
          auctionType: type,
        });
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
      }
    }

    inventoryId = await dcEngine.getInventoryByVin(page, vehicle.vin);
    if (!inventoryId) {
      return {
        success: false,
        error: 'Failed to get inventory ID after registration',
      };
    }
  }

  // Get market price filter
  const {
    filters,
    vehicleInfo,
    id,
    companyId,
  } = await dcEngine.getMarketPriceFilter(page, inventoryId);

  vehicleInfo.odometer = vehicle.odometer;
  const effectiveFilters = filters;

  // Get market price
  const {
    priceAvg: price,
    minPrice,
    maxPrice,
    matching,
    avgOdometer,
    vehicleCount,
  } = await dcEngine.getMarketPrice(
    page,
    effectiveFilters,
    vehicleInfo,
    vehicle.vin,
  );

  // Check if no similar vehicles found
  if (vehicleCount === 0 || vehicleCount < 1) {
    throw new NoCompFoundError(vehicle.vin, vehicleCount, inventoryId);
  }

  // Calculate prices
  const askingPrice = getJustBelowNearestThousand(price);
  const marginPrice = getMarginPrice(askingPrice);

  // Calculate recon cost
  const base = getPriceByMileage(vehicle.odometer);
  const itemCost = getSumOfNumbersInDollars(note);
  const reconCost = base + itemCost + 110 + 125; // 110 for inspection, 125 for detail cleaning

  const lotFee = 500;
  const appraisalValue = askingPrice - reconCost - marginPrice - lotFee;
  const buyerFee =
    type === 'Adesa'
      ? getAdesaFee(appraisalValue)
      : getEdgePipelineFee(appraisalValue);
  const additionalFee = buyerFee + lotFee;
  const currentAppraisalValue = appraisalValue - buyerFee;

  console.log(`Price Analysis for VIN: ${vehicle.vin}`);
  console.log(`- Market Price: $${price}`);
  console.log(`- Asking Price: $${askingPrice}`);
  console.log(`- Margin Price: $${marginPrice}`);
  console.log(`- Recon Cost: $${reconCost}`);
  console.log(`- Appraisal Value: $${appraisalValue}`);
  console.log(`- Buyer Fee: $${buyerFee}`);

  const pricingSummary = buildPricingSummary({
    marketAveragePrice: price,
    askingPrice,
    marginPrice,
    reconCost,
    appraisalValue,
    buyerFee,
    lotFee,
    currentAppraisalValue,
  });

  // Get inventory details
  const inventoryDetail = await dcEngine.getInventoryDetails(page, inventoryId);

  // Update additional fees
  const inventoryFees =
    (inventoryDetail.inventoryAdditionalFees as Array<any>) || [];
  inventoryFees.forEach(fee => {
    if (fee.feeCategoryId === 1) {
      // Buyer Fee
      fee.feeAmount = buyerFee;
    } else if (fee.feeCategoryId === 2) {
      // Lot Fee
      fee.feeAmount = lotFee;
    }
  });

  // Prepare inventory update
  const inventoryUpdate = {
    ...inventoryDetail,
    totalAdditionalFees: additionalFee,
    lotFee: lotFee,
    buyersFee: buyerFee,
    totalCost: additionalFee,
    reconCost: reconCost,
    targetGrossProfit: marginPrice,
    currentAppraisalValue,
    inventoryAdditionalFees: inventoryFees,
  };

  // Save inventory details
  await dcEngine.saveInventoryDetails(
    page,
    inventoryUpdate,
    inventoryId,
    companyId,
    id,
    effectiveFilters,
    vehicleInfo,
  );

  // Save note
  console.log(
    `📝 Saving initial note for inventory ${inventoryId} (VIN ${vehicle.vin})`,
  );
  await dcEngine.saveNote(page, inventoryId, note);
  console.log(`📝 Note saved for inventory ${inventoryId}`);

  // Get market pricing ID
  const marketPricingID = await dcEngine.getMarketPricingID(page, inventoryId);

  // Get price ranking
  const ranking = await dcEngine.getPriceRanking(
    page,
    effectiveFilters,
    vehicleInfo,
    vehicleCount,
  );
  const rank = getRank(askingPrice, ranking);
  const maxRank = ranking.length;

  // Save market pricing detail
  const marketPricingDetailUpdate = {
    entityId: inventoryId,
    entityTypeId: 3,
    marketPricingID: id,
    marketPriceFilterID: marketPricingID,
    minPrice,
    maxPrice,
    avgPrice: price,
    avgOdometer,
    appraisedBy: '08ff48cb-f0c7-4bff-8b66-8d069128d879',
    appraisedByName: 'Appraisal Manager - appraisalmanager',
    marketDataProviderID: 1,
    totalGrossProfit: marginPrice,
    reconEstimate: 0,
    rank,
    maxRank,
    marketPrice: askingPrice,
    marketDaySupply: matching,
    matchedVehicleCount: vehicleCount,
    overallVehicleCount: vehicleCount,
  };

  await dcEngine.saveMarketPricingDetail(page, marketPricingDetailUpdate);

  console.log(`✅ Full appraisal completed for VIN: ${vehicle.vin}`);
  console.log('📊 Pricing summary:', pricingSummary);

  return {
    success: true,
    inventoryId,
    pricingSummary,
    compFilters: extractCompFilters(effectiveFilters),
  };
}

/**
 * Updates an existing appraised vehicle
 * This is a placeholder - user will complete the flow manually
 */
async function updateExistingAppraisal(
  dcEngine: DCEngine,
  page: Page,
  record: AuctionRecordUnion,
  note: string,
  inventoryId: string,
  type: 'Adesa' | 'Edge Pipeline',
  changeContext: PrimaryKeyChangeContext,
): Promise<DCUpdateResult> {
  const { odometerChanged, notesChanged, colorChanged, gradeChanged } = changeContext;
  const updateMode = odometerChanged
    ? notesChanged
      ? 'odometer_and_notes'
      : 'odometer_only'
    : notesChanged
      ? 'notes_only'
      : 'no_primary_change';

  console.log(
    `Updating existing appraisal for VIN: ${record.vin}, Inventory ID: ${inventoryId}`,
  );
  console.log(
    `Update mode: ${updateMode} (odometerChanged=${odometerChanged}, notesChanged=${notesChanged})`,
  );

  const inventoryDetail = await dcEngine.getInventoryDetails(page, inventoryId);
  if (!inventoryDetail) {
    throw new Error(`Inventory ${inventoryId} not found in DealerCenter`);
  }

  if (!inventoryDetail.vehicleBuilds || !inventoryDetail.vehicleBuilds.length) {
    throw new Error(
      `Missing vehicle build data for inventory ${inventoryId}. Manual intervention required.`,
    );
  }

  const marketPriceFilter = await dcEngine.getMarketPriceFilter(
    page,
    inventoryId,
  );
  const { filters, vehicleInfo, id, companyId } = marketPriceFilter;
  const updatedVehicleInfo = { ...vehicleInfo };

  let activeFilters = filters;
  let valuation: any | null = null;
  const vehicle = recordToVehicle(record);
  

  if (odometerChanged || gradeChanged || colorChanged) {

    const kbbBuild = inventoryDetail.vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 1,
    );
    if (!kbbBuild) {
      throw new Error(
        `Unable to locate Kelley build while rebooking inventory ${inventoryId}`,
      );
    }
    const vehicleMeta = {
      year: kbbBuild.year,
      make: kbbBuild.make,
      model: kbbBuild.model,
      trim: kbbBuild.trim,
    };

    valuation = await dcEngine.getInventoryValuation(
      page,
      vehicle,
      vehicleMeta,
      inventoryDetail.vehicleBuilds,
    );

    updatedVehicleInfo.odometer = record.odometer;
    const { filters: adjustedFilters } = await dcEngine.adjustFilters(
      page,
      filters,
      updatedVehicleInfo,
    );
    activeFilters = adjustedFilters || filters;

   
  }

  const {
    priceAvg: price,
    minPrice,
    maxPrice,
    matching,
    avgOdometer,
    vehicleCount,
  } = await dcEngine.getMarketPrice(
    page,
    activeFilters,
    updatedVehicleInfo,
    record.vin,
  );

  // Check if no similar vehicles found
  if (vehicleCount === 0 || vehicleCount < 1) {
    throw new NoCompFoundError(record.vin, vehicleCount, inventoryId);
  }

  const askingPrice = getJustBelowNearestThousand(price);
  const marginPrice = getMarginPrice(askingPrice);

  const odometerForRecon = odometerChanged
    ? record.odometer
    : inventoryDetail.odometer ?? record.odometer;
  const itemCost = getSumOfNumbersInDollars(note);
  const reconCost = getPriceByMileage(odometerForRecon) + itemCost + 110 + 125;
  const lotFee = 500;
  const appraisalValue = askingPrice - reconCost - marginPrice - lotFee;
  const buyerFee =
    type === 'Adesa'
      ? getAdesaFee(appraisalValue)
      : getEdgePipelineFee(appraisalValue);

  const additionalFee = buyerFee + lotFee;
  const currentAppraisalValue = appraisalValue - buyerFee;

  console.log(`Price Analysis for VIN: ${record.vin}`);
  console.log(`- Market Price: $${price}`);
  console.log(`- Asking Price: $${askingPrice}`);
  console.log(`- Margin Price: $${marginPrice}`);
  console.log(`- Recon Cost: $${reconCost}`);
  console.log(`- Appraisal Value: $${appraisalValue}`);
  console.log(`- Buyer Fee: $${buyerFee}`);

  const pricingSummary = buildPricingSummary({
    marketAveragePrice: price,
    askingPrice,
    marginPrice,
    reconCost,
    appraisalValue,
    buyerFee,
    lotFee,
    currentAppraisalValue,
  });

  const inventoryFees =
    (inventoryDetail.inventoryAdditionalFees as Array<any>) || [];
  inventoryFees.forEach(fee => {
    if (fee.feeCategoryId === 1) {
      fee.feeAmount = buyerFee;
    } else if (fee.feeCategoryId === 2) {
      fee.feeAmount = lotFee;
    }
  });

  const vehicleBuildsToPersist = odometerChanged
    ? [
      valuation?.kelleyBuild,
      valuation?.nadaBuild,
      valuation?.blackBookBuild,
      valuation?.manheimBuild,
    ].filter(Boolean)
    : inventoryDetail.vehicleBuilds;


  if (colorChanged || gradeChanged || valuation?.manheimBuild) {
    vehicleBuildsToPersist[3] = valuation?.manheimBuild
  }

  if (
    odometerChanged &&
    (!vehicleBuildsToPersist || vehicleBuildsToPersist.length === 0)
  ) {
    throw new Error(
      `Valuation data missing after rebooking VIN ${record.vin}.`,
    );
  }

  const inventoryUpdate = {
    ...inventoryDetail,
    vehicleBuilds: vehicleBuildsToPersist,
    totalAdditionalFees: additionalFee,
    exteriorColor: vehicle.color,
    lotFee,
    buyersFee: buyerFee,
    totalCost: additionalFee,
    odometer: record.odometer,
    reconCost,
    targetGrossProfit: marginPrice,
    currentAppraisalValue,
    inventoryAdditionalFees: inventoryFees,
  };

  const ranking = await dcEngine.getPriceRanking(
    page,
    activeFilters,
    updatedVehicleInfo,
    vehicleCount,
  );

  const rank = getRank(askingPrice, ranking);
  const maxRank = ranking.length;
  const marketPricingID = await dcEngine.getMarketPricingID(page, inventoryId);
  const marketPricingDetailUpdate = {
    entityId: inventoryId,
    entityTypeId: 3,
    marketPricingID: id,
    marketPriceFilterID: marketPricingID,
    minPrice,
    maxPrice,
    avgPrice: price,
    avgOdometer,
    appraisedBy: '08ff48cb-f0c7-4bff-8b66-8d069128d879',
    appraisedByName: 'Appraisal Manager - appraisalmanager',
    marketDataProviderID: 1,
    totalGrossProfit: marginPrice,
    reconEstimate: 0,
    rank,
    maxRank,
    marketPrice: askingPrice,
    marketDaySupply: matching,
    matchedVehicleCount: vehicleCount,
    overallVehicleCount: vehicleCount,
  };

  await dcEngine.saveMarketPricingDetail(page, marketPricingDetailUpdate);
  await dcEngine.saveInventoryDetails(
    page,
    inventoryUpdate,
    inventoryId,
    companyId,
    id,
    activeFilters,
    updatedVehicleInfo,
  );

  if (notesChanged) {
    console.log(
      `📝 Notes changed for VIN ${record.vin} (inventory ${inventoryId}) - saving updated note`,
    );
    await dcEngine.saveNote(page, inventoryId, note);
    console.log(`📝 Note updated for inventory ${inventoryId}`);
  } else {
    console.log(
      `📝 Notes unchanged for VIN ${record.vin} - skipping note save`,
    );
  }

  console.log(
    `✅ Update completed for VIN: ${record.vin} using mode ${updateMode}`,
  );
  console.log('📊 Pricing summary:', pricingSummary);

  return {
    success: true,
    inventoryId,
    pricingSummary,
    compFilters: extractCompFilters(activeFilters),
  };
}

/**
 * Main DC update implementation
 *
 * Primary keys: odometer and notes (Adesa) / watchNotes (Edge Pipeline)
 *
 * Flow:
 * 1. Check for VIN duplication
 * 2. If nothing appraised yet: Full appraisal flow
 * 3. If already appraised: Update logic (placeholder)
 */
export async function updateDCForAuctionRecord(
  record: AuctionRecordUnion,
  isNewRecord: boolean,
): Promise<DCUpdateResult> {
  const isAdesa = isAdesaRecord(record);
  const recordType = isAdesa ? 'Adesa' : 'Edge Pipeline';
  const note = getNotes(record);

  console.log(
    `\n🔄 DC Update for ${recordType} record - VIN: ${record.vin}, isNew: ${isNewRecord}`,
  );
  console.log(
    `   Primary keys - Odometer: ${record.odometer}, Notes: ${note.substring(
      0,
      50,
    )}...`,
  );

  let dcEngine: DCEngine | null = null;
  let page: Page | null = null;

  try {
    // Initialize DCEngine
    dcEngine = new DCEngine();
    page = await dcEngine.openScraper();

    // Get authentication token
    let token = await dcEngine.getToken(page);

    // If no token, attempt to login with retry logic
    if (!token) {
      console.log('🔐 No token found, attempting to login with retry logic...');
      try {
        token = await attemptLoginWithRetry(dcEngine, page, MAX_LOGIN_RETRIES);
        console.log('✅ Login successful, token obtained');
      } catch (loginError) {
        // MFA challenge - Telegram alert already sent by attemptLoginWithRetry
        if (loginError instanceof MfaRequiredError) {
          return {
            success: false,
            error: loginError.message,
          };
        }

        // If it's a LoginError, we've exhausted all retries
        if (loginError instanceof LoginError) {
          console.error(`❌ Login failed after ${loginError.attempts} attempts`);

          // Send Telegram alert for login failure after max retries
          await enqueueTelegramMessage({
            type: 'system_health',
            component: 'DC Authentication',
            status: `Login failed after ${loginError.maxAttempts} attempts for VIN: ${record.vin}. Last error: ${loginError.message}`,
            details: {
              vin: record.vin,
              attempts: loginError.attempts,
              maxAttempts: loginError.maxAttempts,
            },
          });

          return {
            success: false,
            error: loginError.message,
          };
        }

        // Other login errors
        const errorMessage =
          loginError instanceof Error ? loginError.message : 'Unknown error';
        console.error('❌ Login failed:', loginError);

        // Send Telegram alert for login failure
        await enqueueTelegramMessage({
          type: 'system_health',
          component: 'DC Authentication',
          status: `Login failed: ${errorMessage}. VIN: ${record.vin}`,
        });

        return {
          success: false,
          error: `Login failed: ${errorMessage}`,
        };
      }
    }

    dcEngine.setToken(token);

    // Check for VIN duplication (primary check)
    const inventoryId = await dcEngine.getInventoryByVin(page, record.vin);

    if (!inventoryId) {
      // Nothing appraised yet - perform full appraisal
      console.log(
        `📝 No existing inventory found - performing full appraisal for VIN: ${record.vin}`,
      );
      return await performFullAppraisal(
        dcEngine,
        page,
        record,
        note,
        recordType,
      );
    } else {
      // Already appraised - update existing
      console.log(
        `✏️  Existing inventory found (ID: ${inventoryId}) - updating appraisal for VIN: ${record.vin}`,
      );
      const changeContext = await determinePrimaryKeyChanges(record, note);
      return await updateExistingAppraisal(
        dcEngine,
        page,
        record,
        note,
        inventoryId,
        recordType,
        changeContext,
      );
    }
  } catch (error) {
    console.error(`❌ Error in DC update for VIN: ${record.vin}`, error);

    // If it's an UncoveredCaseError, block the VIN and queue Telegram alert
    if (error instanceof UncoveredCaseError) {
      // Block the VIN
      await blockVin(
        record.vin,
        'Uncovered case in completeVehicleBuild',
        error.question,
        error.message,
      );

      // Queue Telegram alert
      await enqueueTelegramMessage({
        type: 'uncovered_case',
        vin: error.vin,
        question: error.question,
        vehicleTrim: error.vehicleTrim,
      });

      return {
        success: false,
        error: `Uncovered case detected: ${error.message}. VIN has been blocked.`,
      };
    }

    // If it's a NoCompFoundError, block the VIN and queue Telegram alert
    if (error instanceof NoCompFoundError) {
      // Try to get inventoryId if not already in error and inventory exists
      let inventoryId = error.inventoryId;
      if (!inventoryId && dcEngine && page) {
        try {
          const fetchedInventoryId = await dcEngine.getInventoryByVin(
            page,
            record.vin,
          );
          inventoryId = fetchedInventoryId || undefined;
        } catch (e) {
          // Ignore errors when trying to get inventoryId
        }
      }

      // Block the VIN
      await blockVin(
        record.vin,
        'No similar vehicles (comps) found in DC',
        undefined,
        error.message,
      );

      // Queue Telegram alert
      await enqueueTelegramMessage({
        type: 'system_health',
        component: 'DC Market Price',
        status: `No comps found for VIN: ${record.vin}. Vehicle count: ${error.vehicleCount
          }${inventoryId ? `. Inventory ID: ${inventoryId}` : ''}`,
        details: {
          inventoryId,
        },
      });

      return {
        success: false,
        error: `No comps found: ${error.message}. VIN has been blocked.`,
      };
    }

    // If it's a NoVehicleDataError, block the VIN and queue Telegram alert
    if (error instanceof NoVehicleDataError) {
      // Try to get inventoryId if not already in error and inventory exists
      let inventoryId = error.inventoryId;
      if (!inventoryId && dcEngine && page) {
        try {
          const fetchedInventoryId = await dcEngine.getInventoryByVin(
            page,
            record.vin,
          );
          inventoryId = fetchedInventoryId || undefined;
        } catch (e) {
          // Ignore errors when trying to get inventoryId
        }
      }

      // Block the VIN
      await blockVin(
        record.vin,
        'MarketDataBuildMatching API returned null',
        undefined,
        error.message,
      );

      // Queue Telegram alert
      await enqueueTelegramMessage({
        type: 'system_health',
        component: 'DC Market Data',
        status: `No vehicle data returned from MarketDataBuildMatching API for VIN: ${record.vin}${inventoryId ? `. Inventory ID: ${inventoryId}` : ''}`,
        details: {
          inventoryId,
        },
      });

      return {
        success: false,
        error: `No vehicle data: ${error.message}. VIN has been blocked.`,
      };
    }

    // If it's a LoginError, it means login failed after max retries
    // The error was already handled in the login attempt, but we should still return it
    if (error instanceof LoginError) {
      // Telegram message was already sent in attemptLoginWithRetry catch block
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    if (dcEngine) {
      await dcEngine.close();
    }
  }
}

// Function is now exported directly - no initialization needed
// Import and use updateDCForAuctionRecord directly where needed
