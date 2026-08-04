import express from 'express';
import path from 'path';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getBookRequestSchema, notifyRequestSchema } from './interfaces/dealercenter.validation';
import _ from 'lodash';
import { processAuctionCSVContent } from './services/auctionFileProcessor';
import { processAdesaCSVContent } from './services/adesaFileProcessor';
import { getDCUpdateQueue } from './services/jobQueue';
import { enqueueTelegramMessage, getTelegramQueue } from './services/telegramQueue';
import { ensureGoogleDriveAuth } from '@services/googledrive';
import { DCEngine } from '@services/dcengine';
import { attemptLoginWithRetry } from '@services/dc-auth';
import { LoginError } from '@errors/loginError';
import { MfaRequiredError } from '@errors/mfaRequiredError';
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
const scraper = new DCEngine();

app.use(express.json());
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


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/getBook', async (req: any, res: any) => {
  const parsed = getBookRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: 'failed', message: 'Incorrect format for prompts' });
    return;
  }
  const { vin, prompts } = parsed.data;

  try {
    const page = await scraper.openScraper();

    // Get authentication token
    let token = await scraper.getToken(page);

    if (!token) {
      console.log('🔐 No token found, attempting to login with retry logic...');
      try {
        token = await attemptLoginWithRetry(scraper, page);
        console.log('✅ Login successful, token obtained');
      } catch (loginError) {
        // MFA challenge - Telegram alert already sent by attemptLoginWithRetry
        if (loginError instanceof MfaRequiredError) {
          res.status(200).json({
            success: false,
            errorType: 'login',
            error: loginError.message,
          });
          return;
        }

        // If it's a LoginError, we've exhausted all retries
        if (loginError instanceof LoginError) {
          console.error(`Login failed after ${loginError.attempts} attempts`);

          // Send Telegram alert for login failure after max retries
          await enqueueTelegramMessage({
            type: 'system_health',
            component: 'DC Authentication',
            status: `Login failed after ${loginError.maxAttempts} attempts. Last error: ${loginError.message}`,
            details: {
              attempts: loginError.attempts,
              maxAttempts: loginError.maxAttempts,
            },
          });

          res.status(200).json({
            success: false,
            errorType: 'login',
            error: loginError.message,
          });
          return;
        }

        // Other login errors
        const errorMessage =
          loginError instanceof Error ? loginError.message : 'Unknown error';
        console.error('❌ Login failed:', loginError);

        // Send Telegram alert for login failure
        await enqueueTelegramMessage({
          type: 'system_health',
          component: 'DC Authentication',
          status: `Login failed: ${errorMessage}.`,
        });

        res.status(200).json({
          success: false,
          errorType: 'login',
          error: `Login failed: ${errorMessage}`,
        });
        return;
      }
    }

    scraper.setToken(token);



    try {
      let inventoryId = await scraper.getInventoryByVin(page, vin);
      if (!inventoryId) {
        console.log('New Vehicle.')
        const { inventoryId: newID, question, info } = await scraper.registerInteratively(page, vin, prompts);
        if (question) {
          res.status(200).json({
            success: false,
            question
          })
          return
        }
        if (!newID || !info) throw new Error('Invalid function: returned no inventory')
        inventoryId = newID;


      }
      // Get market price filter
      const {
        filters,
        vehicleInfo,

      } = await scraper.getMarketPriceFilter(page, inventoryId);

      // Get market price
      const {
        items,
      } = await scraper.getMarketPrice(
        page,
        filters,
        vehicleInfo,
        vin,
      );

      const { build, market } = await scraper.getVehicleChecks(page, inventoryId)

      res.status(200).json({
        success: true,
        appraisal: {
          inventoryId,
          book: market,
          items,
          build,
        },
      });

    } catch (e) {
      res.status(400).json({
        isCompleted: false,
        errorType: 'runtime',
        error: _.get(e, 'message', 'Something went wrong'),
      });
      return;

    }
  } finally {
    scraper.close();
  }



});


app.get('/health', async (_req: any, res: any) => {
  const authenticated = await scraper.checkAuthenticated().catch(() => false);
  res.status(200).json({
    status: 'healthy',
    authenticated,
  });
});

app.post('/notify', async (req: any, res: any) => {
  const parsed = notifyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  const { type, vin, email, errorType, timestamp } = parsed.data;
  await enqueueTelegramMessage({ type, vin, email, errorType, timestamp });
  res.status(200).json({ ok: true });
});

// Global authentication for all HTTP endpoints
app.use(basicAuthMiddleware);

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

app.get('/auction-upload', async (_req, res) => {
  let googleDriveAuth = false;
  try {
    await ensureGoogleDriveAuth();
    googleDriveAuth = true;
  } catch (err) {
    console.error('Google Drive auth failed (token missing or refresh failed):', err instanceof Error ? err.message : err);
    googleDriveAuth = false;
  }
  res.render('auction-upload', { googleDriveAuth });
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
        `Detected uploaded auction type as ${detected === 'adesa' ? 'Adesa' : 'Edge Pipeline'
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


export default app;
