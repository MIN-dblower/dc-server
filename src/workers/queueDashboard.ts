import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { loadEnvConfig } from '../config/env.config';
loadEnvConfig();
import { getDCUpdateQueue } from '../services/jobQueue';
import { getTelegramQueue } from '../services/telegramQueue';


const PORT = process.env.BULL_BOARD_PORT
  ? parseInt(process.env.BULL_BOARD_PORT, 10)
  : 3001;

/**
 * Basic HTTP Authentication Middleware
 * Validates username and password from Authorization header
 */
function basicAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const username = process.env.BULL_BOARD_USERNAME;
  const password = process.env.BULL_BOARD_PASSWORD;

  // If credentials are not configured, allow access (for development)
  if (!username || !password) {
    console.warn(
      '⚠️  BULL_BOARD_USERNAME and/or BULL_BOARD_PASSWORD not set. Dashboard is unprotected!',
    );
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="BullMQ Dashboard"');
    res.status(401).send('Authentication required');
    return;
  }

  // Decode base64 credentials
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [providedUsername, providedPassword] = credentials.split(':');

  // Validate credentials
  if (providedUsername === username && providedPassword === password) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="BullMQ Dashboard"');
    res.status(401).send('Invalid credentials');
  }
}

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

  // Apply basic authentication middleware before mounting the router
  app.use('/admin/queues', basicAuthMiddleware, serverAdapter.getRouter());

  app.listen(PORT, () => {
    const username = process.env.BULL_BOARD_USERNAME;
    const password = process.env.BULL_BOARD_PASSWORD;
    const authStatus = username && password ? '🔒 Protected' : '⚠️  Unprotected';
    console.log(
      `📊 BullMQ dashboard available at http://localhost:${PORT}/admin/queues (${authStatus})`,
    );
  });
}

void main();

