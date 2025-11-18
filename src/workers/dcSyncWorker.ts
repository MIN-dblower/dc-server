import * as dotenv from 'dotenv';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { getRedisConfig } from '../../config/redis.config';
import { processDCUpdateJob } from '../services/jobProcessor';
import { DC_UPDATE_QUEUE } from '../types/job.types';

dotenv.config();

async function main(): Promise<void> {
  console.log('🧰 Starting DC Sync Worker (BullMQ consumer)...');

  const connection = new IORedis(getRedisConfig());

  const worker = new Worker(DC_UPDATE_QUEUE, processDCUpdateJob, {
    connection,
    concurrency: 1,
  });

  worker.on('completed', job => {
    console.log(`✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job, error) => {
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

