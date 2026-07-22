import { enqueueTelegramMessage, getTelegramQueue } from '@services/telegramQueue';
import { TelegramMessageJobData } from '../types/job.types';

/**
 * Enqueues one example job per Telegram alert type. Requires the telegram
 * worker to be running (npm run dev:telegram) to actually process and send
 * them - this script only enqueues.
 */
const EXAMPLES: TelegramMessageJobData[] = [
  {
    type: 'uncovered_case',
    vin: '1GC1KTEY1KF165568',
    vehicleTrim: 'LTZ',
    question: {
      key: 'transmission',
      type: 'select',
      book: 'nada',
    },
  },
  {
    type: 'blocked_vin_attempt',
    vin: '1GC1KTEY1KF165568',
    details: {
      reason: 'Repeated failures during appraisal',
      timestamp: new Date().toISOString(),
    },
  },
  {
    type: 'job_failure',
    vin: '1GC1KTEY1KF165568',
    jobId: 'test-job-123',
    error: 'Timed out waiting for market data',
  },
  {
    type: 'queue_backup',
    queueLength: 42,
    oldestJobTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    type: 'system_health',
    component: 'DC Authentication',
    status: 'Login failed after 3 attempts. Last error: Failed to retrieve token after login',
    details: { attempts: 3, maxAttempts: 3 },
  },
  {
    type: 'mfa_required',
  },
  {
    type: 'auto_selection_mode',
    vin: '1GC1KTEY1KF165568',
    vehicleTrim: 'LTZ',
    details: {
      key: 'transmission',
      message: 'Multiple transmission options matched - auto-selected the closest match',
      selectedOption: { name: 'Automatic', id: 'auto-1' },
      availableOptions: [{ name: 'Automatic' }, { name: 'Manual' }],
      auctionType: 'Adesa',
      inventoryId: 'inv-test-123',
    },
  },
  {
    type: 'dc_sync_completed',
    vin: '1GC1KTEY1KF165568',
    dcSyncDetails: {
      inventoryId: 'inv-test-123',
      auctionType: 'Adesa',
      auctionLocation: 'Adesa Boston',
      odometer: 192879,
      compFilters: {
        odometerMin: 170000,
        odometerMax: 210000,
        radiusInMiles: 100,
        years: [2018, 2019, 2020],
        trims: ['LTZ'],
      },
      pricingSummary: {
        marketAveragePrice: 28500,
        askingPrice: 26900,
        appraisalValue: 24000,
        reconCost: 1200,
      },
    },
  },
];

async function main(): Promise<void> {
  const typeFilter = process.argv[2];
  const toSend = typeFilter
    ? EXAMPLES.filter(example => example.type === typeFilter)
    : EXAMPLES;

  if (toSend.length === 0) {
    console.error(`No example found for type "${typeFilter}"`);
    console.error(`Available types: ${EXAMPLES.map(e => e.type).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  for (const example of toSend) {
    await enqueueTelegramMessage(example);
  }

  console.log(`\nEnqueued ${toSend.length} example Telegram message(s).`);
  console.log('Run "npm run dev:telegram" if the worker is not already running to see them delivered.');
}

main()
  .catch(error => {
    console.error('Failed to enqueue test Telegram messages:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getTelegramQueue().close();
    process.exit(process.exitCode ?? 0);
  });
