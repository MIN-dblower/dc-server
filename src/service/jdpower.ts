import * as cheerio from 'cheerio';
import { Window } from "../class/window";

export class JDpower {
    vin: string;
    window: Window;
    screenshotDir: string;
    constructor(vin: string,) {
        this.vin = vin;
        this.window = new Window();
        this.screenshotDir = 'screenshots/jdpower/';
    }
    async getData() {
        const page = await this.window.connect();
        // return;
        await page.goto('https://www.jdpower.com/cars/vin-lookup-and-decoder', {
            waitUntil: 'networkidle2',
        })
        await page.screenshot({ path: this.screenshotDir + '1.png' });
        console.log('Page Loaded');
        await page.type('#VIN', this.vin);
        console.log('VIN entered');
        await page.screenshot({ path: this.screenshotDir + '2.png' });
        const buttonHandle = await page.$x("//button[normalize-space()='Check VIN']");

        // Click the button if it exists  
        if (buttonHandle && buttonHandle.length > 0) {
            await Promise.all([page.waitForXPath("//button[normalize-space()='Check VIN']"), buttonHandle[0].click(), page.waitForNavigation({ waitUntil: 'networkidle0' })]);
        } else {
            console.log("Button not found.");
        }
        await page.screenshot({ path: this.screenshotDir + '3.png' });
        const specLinkHandler = await page.$x("//a[contains(text(), 'See Full Specs')]");
        if (specLinkHandler.length) {
            await specLinkHandler[0].press('Enter');
            // const text = await specLinkHandler[0].
            await Promise.all([page.waitForXPath("//a[contains(text(), 'See Full Specs')]"), page.evaluate(b => b.click(), specLinkHandler[0]), page.waitForNavigation({ waitUntil: 'networkidle0' })]);
        } else {
            console.log('Link not found');
        }
        console.log('Specs Page');
        await page.screenshot({ path: this.screenshotDir + '4.png' });
        const tabHandler = await page.$$("button#scrollable-auto-tab-0");
        if (tabHandler.length) {
            await Promise.all([page.waitForSelector("button#scrollable-auto-tab-0"), tabHandler[0].click(), page.waitForNavigation()]);
        } else {
            console.log('Tab not found');
        }
        console.log('Values Tab');
        const pageText = await page.content();
        return pageText;


    }
    async exit(){
        await this.window.disconnect();
    }
    parseText(text: string) {
        const $ = cheerio.load(text);
        const priceDiv = $('div:contains("Average Price Paid")');
        const averagePrice = priceDiv.next('span').text();
        const priceRangeAnchor = $('div:contains("80% of People Paid")');
        const priceRangeSpans = priceRangeAnchor.next('div').children('h2').children('span');
        const priceRange = [priceRangeSpans.eq(0).text(), priceRangeSpans.eq(1).text()]
        console.log('Average Price Paid:', averagePrice, priceRange);
        return {
            low: priceRange[0],
            avg: averagePrice,
            high: priceRange[1],
        }
    }
}