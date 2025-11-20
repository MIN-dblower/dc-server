import express from 'express';
import { DataCenterScraper } from './services/datacenter';
import { Page } from 'puppeteer';
import { userPromptSchema } from './interfaces/dealercenter.validation';
import _ from 'lodash';

const app = express();
const scraper = new DataCenterScraper();
let page: Page;
export async function init() {
  page = await scraper.openScraper();
  // await scraper.login(page);
}
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
