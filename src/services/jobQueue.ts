import { Queue, JobsOptions, Job } from 'bullmq';
import IORedis from 'ioredis';
import crypto from 'crypto';
import { getRedisConfig } from '../config/redis.config';
import {
  DC_UPDATE_JOB,
  DC_UPDATE_QUEUE,
  DCUpdateJobData,
  JobStatusSummary,
} from '../types/job.types';

const connection = new IORedis(getRedisConfig());

const dcUpdateQueue = new Queue<DCUpdateJobData>(DC_UPDATE_QUEUE, {
  connection,
});

connection.on('error', (error: Error) => {
  console.error('Redis connection error for BullMQ queue', error);
});

function generateJobId(vin: string, timestamp: Date): string {
  const timestampStr = timestamp.getTime().toString();
  const hash = crypto
    .createHash('md5')
    .update(`${vin}-${timestampStr}`)
    .digest('hex')
    .substring(0, 8);

  return `dc-update-${vin}-${timestampStr}-${hash}`;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: 100,
  removeOnFail: 50,
  jobId: undefined,
};

export interface EnqueueJobResult {
  job: Job<DCUpdateJobData>;
  wasDuplicate: boolean;
}

export async function enqueueDCUpdateJob(
  data: Omit<DCUpdateJobData, 'timestamp'> & { timestamp?: string },
): Promise<EnqueueJobResult> {
  const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
  const vin = data.record.vin;

  const existingJobs = await dcUpdateQueue.getJobs([
    'waiting',
    'active',
    'delayed',
    'waiting-children',
  ]);

  const duplicateJob = existingJobs.find(
    job => job.data.record.vin === vin,
  );

  if (duplicateJob) {
    const state = await duplicateJob.getState();
    console.log(
      `Job for VIN ${vin} already exists in ${state} state, skipping enqueue`,
    );
    return { job: duplicateJob, wasDuplicate: true };
  }

  const jobId = generateJobId(vin, timestamp);
  const jobData: DCUpdateJobData = {
    ...data,
    timestamp: timestamp.toISOString(),
  };

  const jobOptions: JobsOptions = {
    ...DEFAULT_JOB_OPTIONS,
    jobId,
  };

  const job = await dcUpdateQueue.add(DC_UPDATE_JOB, jobData, jobOptions);
  return { job, wasDuplicate: false };
}

export async function getJobStatusByVin(
  vin: string,
): Promise<JobStatusSummary | null> {
  const jobs = await dcUpdateQueue.getJobs([
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
  ]);

  const job = jobs.find(existingJob => existingJob.data.record.vin === vin);
  if (!job) {
    return null;
  }

  const state = await job.getState();

  return {
    jobId: job.id as string,
    vin,
    state: state ?? 'unknown',
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? undefined,
    nextRunAt: job.processedOn
      ? new Date(job.processedOn).toISOString()
      : undefined,
  };
}

export function getDCUpdateQueue(): Queue<DCUpdateJobData> {
  return dcUpdateQueue;
}

/**
 * Pause jobs for a blocked VIN by moving them to delayed state
 * This prevents the jobs from being processed until the VIN is unblocked
 */
export async function pauseJobsForBlockedVin(vin: string): Promise<number> {
  try {
    // Get all jobs for this VIN in waiting, active, or delayed states
    const allJobs = await dcUpdateQueue.getJobs([
      'waiting',
      'active',
      'delayed',
    ]);

    const jobsForVin = allJobs.filter(
      job => job.data.record.vin === vin,
    );

    let pausedCount = 0;
    const PAUSE_DELAY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year delay (effectively paused)

    for (const job of jobsForVin) {
      const state = await job.getState();
      
      // Skip jobs that are already delayed (already paused)
      if (state === 'delayed') {
        continue;
      }

      try {
        if (state === 'waiting') {
          // For waiting jobs, remove and re-add with delay
          await job.remove();
          await dcUpdateQueue.add(
            DC_UPDATE_JOB,
            job.data,
            {
              delay: PAUSE_DELAY_MS,
              jobId: job.id, // Keep the same job ID
              attempts: job.opts.attempts || 3,
              backoff: job.opts.backoff,
              removeOnComplete: job.opts.removeOnComplete,
              removeOnFail: job.opts.removeOnFail,
            },
          );
          pausedCount++;
          console.log(
            `⏸️  Paused waiting job ${job.id} for blocked VIN ${vin}`,
          );
        } else if (state === 'active') {
          // For active jobs, try to move to delayed
          // Note: This may fail if the job is currently being processed
          try {
            await job.moveToDelayed(Date.now() + PAUSE_DELAY_MS);
            pausedCount++;
            console.log(
              `⏸️  Paused active job ${job.id} for blocked VIN ${vin}`,
            );
          } catch (moveError) {
            // If move fails (job is being processed), log and continue
            // The job will be handled by the failed handler when it throws BlockedVinError
            console.warn(
              `⚠️  Could not pause active job ${job.id} for blocked VIN ${vin} (may be processing):`,
              moveError instanceof Error ? moveError.message : moveError,
            );
          }
        }
      } catch (jobError) {
        console.error(
          `Error pausing job ${job.id} for blocked VIN ${vin}:`,
          jobError,
        );
        // Continue with other jobs even if one fails
      }
    }

    return pausedCount;
  } catch (error) {
    console.error(`Error pausing jobs for blocked VIN ${vin}:`, error);
    throw error;
  }
}

/**
 * Resume jobs for an unblocked VIN by removing the delay
 * This allows the jobs to be processed immediately
 */
export async function resumeJobsForUnblockedVin(vin: string): Promise<number> {
  try {
    // Get all jobs for this VIN, especially delayed ones
    const allJobs = await dcUpdateQueue.getJobs([
      'waiting',
      'active',
      'delayed',
    ]);

    const jobsForVin = allJobs.filter(
      job => job.data.record.vin === vin,
    );

    let resumedCount = 0;

    for (const job of jobsForVin) {
      const state = await job.getState();
      
      // Resume delayed jobs by promoting them to waiting
      if (state === 'delayed') {
        await job.promote();
        resumedCount++;
        console.log(
          `▶️  Resumed job ${job.id} for unblocked VIN ${vin}`,
        );
      }
    }

    return resumedCount;
  } catch (error) {
    console.error(`Error resuming jobs for unblocked VIN ${vin}:`, error);
    throw error;
  }
}

