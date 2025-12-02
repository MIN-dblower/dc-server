/**
 * Telegram Message Worker
 * 
 * Processes Telegram message jobs from the queue
 */

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { loadEnvConfig } from '../config/env.config';
import { getRedisConfig } from '../config/redis.config';
import {
  TELEGRAM_MESSAGE_QUEUE,
  TELEGRAM_MESSAGE_JOB,
} from '../types/job.types';
import { processTelegramMessage } from '../services/telegramProcessor';

// Initialize environment configuration
loadEnvConfig();

async function main(): Promise<void> {
  console.log('📱 Starting Telegram Message Worker...');

  const connection = new IORedis(getRedisConfig());

  const worker = new Worker(TELEGRAM_MESSAGE_QUEUE, processTelegramMessage, {
    connection,
    concurrency: 5, // Can process multiple messages concurrently
  });

  worker.on('completed', job => {
    console.log(`✅ Telegram message job ${job.id} completed`);
  });

  worker.on('failed', (job, error) => {
    console.error(`❌ Telegram message job ${job?.id} failed:`, error);
  });

  worker.on('error', error => {
    console.error('Telegram worker encountered an error', error);
  });

  const shutdown = async (): Promise<void> => {
    console.log('\n🛑 Shutting down Telegram Message Worker...');
    await worker.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();

