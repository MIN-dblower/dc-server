import express from 'express';
import path from 'path';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { DataCenterScraper } from './services/datacenter';
import { Page } from 'puppeteer';
import { userPromptSchema } from './interfaces/dealercenter.validation';
import _ from 'lodash';
import { processAuctionCSVContent } from './services/auctionFileProcessor';
import { processAdesaCSVContent } from './services/adesaFileProcessor';
import { getDCUpdateQueue } from './services/jobQueue';
import { getTelegramQueue } from './services/telegramQueue';

// Use require to avoid any TypeScript type dependency on multer
// tslint:disable-next-line:no-var-requires
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

const app = express();
const scraper = new DataCenterScraper();
let page: Page;
export async function init() {
  page = await scraper.openScraper();
  // await scraper.login(page);
}

/**
 * Basic HTTP Authentication Middleware
 * Reuses the Bull Board credentials to protect all routes.
 */
function basicAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const username = process.env.BULL_BOARD_USERNAME;
  const password = process.env.BULL_BOARD_PASSWORD;

  // If credentials are not configured, allow access (primarily for development)
  if (!username || !password) {
    console.warn(
      '⚠️  BULL_BOARD_USERNAME and/or BULL_BOARD_PASSWORD not set. HTTP endpoints are unprotected!',
    );
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="DealerCenter Tools"');
    res.status(401).send('Authentication required');
    return;
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [providedUsername, providedPassword] = credentials.split(':');

  if (providedUsername === username && providedPassword === password) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="DealerCenter Tools"');
    res.status(401).send('Invalid credentials');
  }
}

// Configure view engine for UI templates
app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'pug');

// Global authentication for all HTTP endpoints
app.use(basicAuthMiddleware);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// BullMQ dashboard (Bull Board) under the main app
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

function detectAuctionTypeFromHeader(
  headerLine: string,
): 'adesa' | 'edge' | null {
  const normalized = headerLine.toLowerCase();

  if (
    normalized.includes('lane / run') ||
    normalized.includes('lane/run') ||
    normalized.includes('sale channel')
  ) {
    return 'adesa';
  }

  if (
    normalized.includes('auction name') ||
    normalized.includes('watch notes') ||
    normalized.includes('stock #')
  ) {
    return 'edge';
  }

  return null;
}

app.get('/auction-upload', (_req, res) => {
  res.render('auction-upload');
});

app.post(
  '/auction-upload',
  upload.single('file'),
  async (req: any, res: any) => {
    try {
      if (!req.file) {
        res.status(400).send('CSV file is required.');
        return;
      }

      const file = req.file;
      const csvContent = file.buffer.toString('utf-8');
      const trimmed = csvContent.trim();

      if (!trimmed) {
        res.status(400).send('Uploaded file is empty.');
        return;
      }

      const [headerLine] = trimmed.split('\n');
      const detected = detectAuctionTypeFromHeader(headerLine || '');

      if (!detected) {
        res
          .status(400)
          .send(
            'Unable to determine auction type from CSV header. Please verify this is an Adesa or Edge Pipeline export.',
          );
        return;
      }

      console.log(
        `Detected uploaded auction type as ${
          detected === 'adesa' ? 'Adesa' : 'Edge Pipeline'
        } for file: ${file.originalname}`,
      );

      const fileName = file.originalname || 'upload.csv';
      const sourceId = 'http-upload';

      let result;

      if (detected === 'adesa') {
        result = await processAdesaCSVContent(trimmed, fileName, sourceId);
      } else {
        result = await processAuctionCSVContent(trimmed, fileName, sourceId);
      }

      const auctionLabel = detected === 'adesa' ? 'Adesa' : 'Edge Pipeline';

      res.render('auction-result', {
        auctionLabel,
        fileName,
        result,
      });
    } catch (error) {
      console.error('Error handling uploaded auction CSV:', error);
      res
        .status(500)
        .send(
          'An unexpected error occurred while processing the CSV file. Check server logs for details.',
        );
    }
  },
);
app.post('/getBook', async (req: any, res: any) => {
  const { vin, prompts } = req.body;
  try {
    userPromptSchema.parse(prompts || []);
  } catch {
    res.status(400).json({
      status: 'failed',
      message: 'Incorrect format for prompts',
    });
    return;
  }
  try {
    const data = await scraper.getData(page, vin, prompts);
    res.status(200).json({
      data,
    });
  } catch (e) {
    res.status(400).json({
      isCompleted: false,
      error: _.get(e, 'message', 'Something went wrong'),
    });
  }
});

export default app;
