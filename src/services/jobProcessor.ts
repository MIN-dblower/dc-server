import { Job } from 'bullmq';
import { AdesaRecord } from '../interfaces/adesa.types';
import { EdgePipelineRecord } from '../interfaces/edgePipeline.types';
import { saveOrUpdateAdesaRecord } from '../storage/adesaDb';
import { saveOrUpdateRecord } from '../storage/db';
import {
  updateDCForAuctionRecord,
  DCUpdateResult,
} from './dcUpdateInterface';
import { DCUpdateJobData } from '../types/job.types';
import { isVinBlocked, getBlockedVinDetails } from './blockedVins';
import { pauseJobsForBlockedVin } from './jobQueue';
import { enqueueTelegramMessage } from './telegramQueue';
import { BlockedVinError } from '../errors/blockedVinError';

function isAdesaRecord(record: AdesaRecord | EdgePipelineRecord): record is AdesaRecord {
  return (record as AdesaRecord).laneRun !== undefined;
}

export async function processDCUpdateJob(
  job: Job<DCUpdateJobData>,
): Promise<DCUpdateResult> {
  const { record, isNewRecord } = job.data;

  console.log(`\n⚙️  Processing DC job ${job.id} for VIN ${record.vin}`);


  const dcResult = await updateDCForAuctionRecord(record, isNewRecord);

  if (!dcResult.success) {
    const errorMessage = dcResult.error || 'Unknown DC update error';
    console.error(`❌ DC update failed for VIN ${record.vin}: ${errorMessage}`);
    throw new Error(errorMessage);
  }

  if (isAdesaRecord(record)) {
    await saveOrUpdateAdesaRecord(record);
  } else {
    await saveOrUpdateRecord(record);
  }

  if (dcResult.pricingSummary) {
    console.log(`📊 Job ${job.id} pricing summary:`, dcResult.pricingSummary);
  }

  console.log(`✅ DC job ${job.id} completed for VIN ${record.vin}`);
  return dcResult;
}

