
import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'], });

  const page = await browser.newPage();

  await page.goto('https://www.jdpower.com/cars/vin-lookup-and-decoder');

  browser.close();
})();
