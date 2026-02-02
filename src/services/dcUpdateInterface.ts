import { AdesaRecord } from '../interfaces/adesa.types';
import { EdgePipelineRecord } from '../interfaces/edgePipeline.types';
import { updateDCForAuctionRecord } from './dcUpdateExample';

/**
 * Interface for updating vehicle entries in Data Center
 * 
 * This interface provides a hook point for updating DC before saving to database.
 * The actual DC update implementation is in dcUpdateExample.ts
 */

export interface PricingSummary {
  marketAveragePrice: number;
  askingPrice: number;
  marginPrice: number;
  reconCost: number;
  appraisalValue: number;
  buyerFee: number;
  lotFee: number;
  currentAppraisalValue: number;
}

export interface CompFilters {
  odometerMin: number | null;
  odometerMax: number | null;
  radiusInMiles: number;
  years?: number[];
  trims?: string[];
}

export interface DCUpdateResult {
  success: boolean;
  inventoryId?: string;
  error?: string;
  pricingSummary?: PricingSummary;
  compFilters?: CompFilters;
}

/**
 * Union type for auction records (Adesa or Edge Pipeline)
 */
export type AuctionRecordUnion = AdesaRecord | EdgePipelineRecord;

export { updateDCForAuctionRecord } from './dcUpdateExample';

/**
 * Updates a vehicle entry in Data Center
 * This is the main function to call before saving to database
 * Directly calls the implementation from dcUpdateExample.ts
 * 
 * @param record - The auction record (Adesa or Edge Pipeline) to update
 * @param isNewRecord - Whether this is a new record
 * @returns Promise resolving to the update result
 */
export async function updateVehicleInDC(
  record: AuctionRecordUnion,
  isNewRecord: boolean
): Promise<DCUpdateResult> {
  try {
    console.log(
      `${isNewRecord ? 'Creating' : 'Updating'} vehicle in DC for VIN: ${record.vin}`
    );
    const result = await updateDCForAuctionRecord(record, isNewRecord);
    
    if (result.success) {
      console.log(`✅ DC update successful for VIN: ${record.vin}`);
    } else {
      console.error(`❌ DC update failed for VIN: ${record.vin}`, result.error);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Error updating DC for VIN: ${record.vin}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Batch update multiple vehicles in DC
 * 
 * @param records - Array of auction records (Adesa or Edge Pipeline) to update
 * @param isNewRecords - Array indicating which records are new (parallel to records array)
 * @returns Promise resolving to array of update results
 */
export async function batchUpdateVehiclesInDC(
  records: AuctionRecordUnion[],
  isNewRecords: boolean[]
): Promise<DCUpdateResult[]> {
  const results: DCUpdateResult[] = [];
  
  for (let i = 0; i < records.length; i++) {
    const result = await updateVehicleInDC(records[i], isNewRecords[i]);
    results.push(result);
    
    // Small delay to avoid overwhelming the API
    if (i < records.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}


