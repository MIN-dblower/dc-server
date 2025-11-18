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

import { AuctionRecordUnion, DCUpdateResult } from './dcUpdateInterface';
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
} from '../utils/auction';
import { AdesaRecord } from '../interfaces/adesa.types';
import { EdgePipelineRecord } from '../interfaces/edgePipeline.types';
import { Page } from 'puppeteer';
import { isVinBlocked, getBlockedVinDetails, blockVin } from './blockedVins';
import { enqueueTelegramMessage } from './telegramQueue';
import { UncoveredCaseError } from '../errors/uncoveredCaseError';

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

/**
 * Converts an auction record to IVehicle format
 */
function recordToVehicle(record: AuctionRecordUnion): IVehicle {
  return {
    vin: record.vin,
    make: record.make,
    model: record.model,
    year: record.year,
    odometer: record.odometer,
    trim: isAdesaRecord(record) ? (record.trim || '') : '',
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
  try {
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

    // Get market price
    const {
      priceAvg: price,
      minPrice,
      maxPrice,
      matching,
      avgOdometer,
      vehicleCount,
    } = await dcEngine.getMarketPrice(page, filters, vehicleInfo);

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

    // Get inventory details
    const inventoryDetail = await dcEngine.getInventoryDetails(
      page,
      inventoryId,
    );

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
      filters,
      vehicleInfo,
    );

    // Save note
    await dcEngine.saveNote(page, inventoryId, note);

    // Get market pricing ID
    const marketPricingID = await dcEngine.getMarketPricingID(
      page,
      inventoryId,
    );

    // Get price ranking
    const ranking = await dcEngine.getPriceRanking(
      page,
      filters,
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

    return {
      success: true,
      inventoryId,
    };
  } catch (error) {
    console.error(
      `Error performing full appraisal for VIN: ${record.vin}`,
      error,
    );
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error during appraisal',
    };
  }
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
): Promise<DCUpdateResult> {
  try {
    console.log(
      `Updating existing appraisal for VIN: ${record.vin}, Inventory ID: ${inventoryId}`,
    );
    console.log(
      `Primary keys changed - Odometer: ${
        record.odometer
      }, Notes: ${note.substring(0, 50)}...`,
    );

    // TODO: User will provide the flow manually, then complete this section
    //
    // Steps to implement:
    // 1. Get current inventory details
    // 2. Get valuation
    // 3. Get market price filter with updated vehicleInfo (odometer)
    // 4. Adjust filters based on new odometer
    // 5. Recalculate prices if needed
    // 6. Update inventory with new odometer and notes
    // 7. Save updated appraisal data
    //
    // Placeholder implementation:
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
      record.vin,
      record.odometer,
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
    const itemCost = getSumOfNumbersInDollars(note);
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
    await dcEngine.saveNote(page, inventoryId, note);

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
    const marketPricingID = await dcEngine.getMarketPricingID(
      page,
      inventoryId!,
    );
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

    return {
      success: true,
      inventoryId,
    };
  } catch (error) {
    console.error(
      `Error updating existing appraisal for VIN: ${record.vin}`,
      error,
    );
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Unknown error during update',
    };
  }
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

  // Check if VIN is blocked before processing
  const blocked = await isVinBlocked(record.vin);
  if (blocked) {
    const details = await getBlockedVinDetails(record.vin);
    console.warn(
      `\n🚫 VIN ${record.vin} is blocked from processing. Reason: ${details?.reason || 'Unknown'}`,
    );
    
    // Queue Telegram alert about blocked VIN attempt
    if (details) {
      await enqueueTelegramMessage({
        type: 'blocked_vin_attempt',
        vin: record.vin,
        details,
      });
    }

    return {
      success: false,
      error: `VIN is blocked: ${details?.reason || 'Unknown reason'}. Please unblock the VIN after fixing the issue.`,
    };
  }

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
    const token = await dcEngine.getToken(page);
    if (!token) {
      return {
        success: false,
        error: 'Failed to get authentication token',
      };
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
      return await updateExistingAppraisal(
        dcEngine,
        page,
        record,
        note,
        inventoryId,
        recordType,
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
