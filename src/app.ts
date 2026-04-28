import express from 'express';

import { userPromptSchema } from './interfaces/dealercenter.validation';
import _ from 'lodash';
import { DCEngine } from '@services/dcengine';
import { enqueueTelegramMessage } from '@services/telegramQueue';
import { LoginError } from '@errors/loginError';
import { attemptLoginWithRetry } from '@services/dc-auth';

const app = express();
const scraper = new DCEngine();

app.use(express.json());
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
    const page = await scraper.openScraper();

    // Get authentication token
    let token = await scraper.getToken(page);

    if (!token) {
      console.log('🔐 No token found, attempting to login with retry logic...');
      try {
        token = await attemptLoginWithRetry(scraper, page);
        console.log('✅ Login successful, token obtained');
      } catch (loginError) {
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
        error: _.get(e, 'message', 'Something went wrong'),
      });
      return;

    }
  } finally {
    scraper.close();
  }



});

export default app;
