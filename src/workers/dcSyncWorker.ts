import { loadEnvConfig } from '../config/env.config';
loadEnvConfig();
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

import { getRedisConfig } from '../config/redis.config';
import { processDCUpdateJob } from '../services/jobProcessor';
import { DC_UPDATE_QUEUE, DC_UPDATE_JOB, DCUpdateJobData } from '../types/job.types';
import { BlockedVinError } from '../errors/blockedVinError';
import { MfaRequiredError } from '../errors/mfaRequiredError';
import { UncoveredCaseError } from '../errors/uncoveredCaseError';
import { isVinBlocked, getBlockedVinDetails } from '../services/blockedVins';
import { pauseJobsForBlockedVin, getDCUpdateQueue } from '../services/jobQueue';
import { enqueueTelegramMessage } from '../services/telegramQueue';
import { DCUpdateResult } from '../services/dcUpdateInterface';
import { AdesaRecord } from '../interfaces/adesa.types';

async function reportJobError(error: unknown, vin: string, jobId?: string): Promise<void> {
  try {
    if (error instanceof MfaRequiredError) {
      await enqueueTelegramMessage({ type: 'mfa_required' });
    } else if (error instanceof UncoveredCaseError) {
      await enqueueTelegramMessage({
        type: 'uncovered_case',
        vin: error.vin,
        question: error.question,
        vehicleTrim: error.vehicleTrim,
      });
    } else {
      await enqueueTelegramMessage({
        type: 'job_failure',
        vin,
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (telegramError) {
    console.error(`Failed to enqueue Telegram error notification for job ${jobId}:`, telegramError);
  }
}

async function processJobWithBlockedVinCheck(
  job: Job<DCUpdateJobData>,
): Promise<any> {
  const { record } = job.data;

  const blocked = await isVinBlocked(record.vin);
  if (blocked) {
    const details = await getBlockedVinDetails(record.vin);
    const reason = details?.reason || 'Unknown reason';
    console.warn(
      `\n🚫 VIN ${record.vin} is blocked. Pausing job ${job.id}. Reason: ${reason}`,
    );

    await pauseJobsForBlockedVin(record.vin);

    if (details) {
      await enqueueTelegramMessage({
        type: 'blocked_vin_attempt',
        vin: record.vin,
        details,
      });
    }

    throw new BlockedVinError(record.vin, reason);
  }

  try {
    return await processDCUpdateJob(job);
  } catch (error) {
    await reportJobError(error, record.vin, job.id);
    throw error;
  }
}

async function main(): Promise<void> {
  console.log('🧰 Starting DC Sync Worker (BullMQ consumer)...');

  const connection = new IORedis(getRedisConfig());

  const worker = new Worker(DC_UPDATE_QUEUE, processJobWithBlockedVinCheck, {
    connection,
    concurrency: 1,
  });

  worker.on('completed', async (job, result: DCUpdateResult) => {
    console.log(`✅ Job ${job.id} completed`);
    if (result?.pricingSummary) {
      console.log(
        `📊 BullMQ return value for job ${job.id}:`,
        result.pricingSummary,
      );
    }

    // Enqueue Telegram notification for successful DC sync
    if (result?.success && result.inventoryId && result.compFilters) {
      const { record, auctionType } = job.data;
      // Get auction location based on record type
      const auctionLocation = 'laneRun' in record 
        ? (record as AdesaRecord).location 
        : record.auctionName;

      try {
        await enqueueTelegramMessage({
          type: 'dc_sync_completed',
          vin: record.vin,
          dcSyncDetails: {
            inventoryId: result.inventoryId,
            auctionType,
            auctionLocation,
            odometer: record.odometer,
            compFilters: result.compFilters,
            pricingSummary: result.pricingSummary ? {
              marketAveragePrice: result.pricingSummary.marketAveragePrice,
              askingPrice: result.pricingSummary.askingPrice,
              appraisalValue: result.pricingSummary.appraisalValue,
              reconCost: result.pricingSummary.reconCost,
            } : undefined,
          },
        });
      } catch (telegramError) {
        console.error(`Failed to enqueue Telegram notification for job ${job.id}:`, telegramError);
      }
    }
  });

  worker.on('failed', async (job, error) => {
    // If it's a BlockedVinError, pause the job to prevent retries
    if (error instanceof BlockedVinError && job) {
      try {
        const queue = getDCUpdateQueue();
        const state = await job.getState();
        
        // If job is in failed state, we need to re-add it as delayed
        // Otherwise, try to move it to delayed
        if (state === 'failed') {
          // Remove the failed job and re-add it as delayed
          const PAUSE_DELAY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
          await job.remove();
          
          // Re-add the job with a delay
          await queue.add(
            DC_UPDATE_JOB,
            job.data,
            {
              delay: PAUSE_DELAY_MS,
              jobId: job.id, // Keep the same job ID
            },
          );
          
          console.log(
            `⏸️  Job ${job.id} paused (re-added as delayed) due to blocked VIN: ${error.vin}`,
          );
        } else {
          // Try to move to delayed if job is in a different state
          const PAUSE_DELAY_MS = 365 * 24 * 60 * 60 * 1000;
          await job.moveToDelayed(Date.now() + PAUSE_DELAY_MS);
          console.log(
            `⏸️  Job ${job.id} paused due to blocked VIN: ${error.vin}`,
          );
        }
      } catch (pauseError) {
        // If we can't pause it, log it but don't treat it as a regular failure
        console.warn(
          `⚠️  Could not pause job ${job.id} for blocked VIN ${error.vin}:`,
          pauseError,
        );
      }
      return;
    }
    console.error(`❌ Job ${job?.id} failed`, error);
  });

  worker.on('error', error => {
    console.error('Worker encountered an error', error);
  });

  const shutdown = async (): Promise<void> => {
    console.log('\n🛑 Shutting down DC Sync Worker...');
    await worker.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();

