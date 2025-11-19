import express from 'express';
import { DataCenterScraper } from './service/datacenter';
import { Page } from 'puppeteer';
import { userPromptSchema } from './interfaces/dealercenter.validation';
const app = express();
const scraper = new DataCenterScraper();
let page: Page;
export async function init() {
    page = await scraper.openScraper();
    await scraper.login(page);

}
let isPending = false;
app.use(express.json());
app.post('/getBook', async (req: any, res: any) => {
    const { vin, odometer, prompts } = req.body;
    try {
        userPromptSchema.parse(prompts || []);
    } catch {
        res.status(400).json({
            status: "failed",
            message: "Incorrect format for prompts"
        })
        return;
    }
    if (!isPending) {
        isPending = true;
        const data = await scraper.getData(page, vin, { odometer: odometer ? parseInt(odometer) : undefined, prompts });
        res.status(200).json({
            data
        })
        isPending = false;
    } else {
        res.status(400).json({
            status: 'failed',
            message: 'Process is busy now'
        })
    }

});

export default app;