import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { loadEnvConfig } from '../config/env.config';
import { getDCUpdateQueue } from '../services/jobQueue';
import { getTelegramQueue } from '../services/telegramQueue';

// Initialize environment configuration
loadEnvConfig();

const PORT = process.env.BULL_BOARD_PORT
  ? parseInt(process.env.BULL_BOARD_PORT, 10)
  : 3001;

async function main(): Promise<void> {
  const app = express();

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(getDCUpdateQueue()),
      new BullMQAdapter(getTelegramQueue()),
    ],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());

  app.listen(PORT, () => {
    console.log(
      `📊 BullMQ dashboard available at http://localhost:${PORT}/admin/queues`,
    );
  });
}

void main();

