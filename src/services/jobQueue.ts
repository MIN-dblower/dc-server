import { Queue, JobsOptions, Job } from 'bullmq';
import IORedis from 'ioredis';
import crypto from 'crypto';
import { getRedisConfig } from '../../config/redis.config';
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

