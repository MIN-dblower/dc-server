import app, { init } from './app';
import { DataCenterScraper } from './services/datacenter';

async function scrapeDataCenter() {
  const scraper = new DataCenterScraper();
  const page = await scraper.openScraper();
  // scraper.startTokenInvalidation(page, 1000 * 60 * 5);
  // await scraper.loginAPI(page);
  // const data = await scraper.getData(page);
  // const result = scraper.anaylzeContent(data);
  // console.log('HERE', JSON.stringify(result, null, 2));
}
// scrapeKBB();
// scrapeJDPower();
// scrapeDataCenter();
init().then(async () => {
  await scrapeDataCenter();
  app.listen(10003, () => {
    console.log('App successfully started.');
  });
});
