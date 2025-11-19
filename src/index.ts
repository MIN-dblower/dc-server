import app, { init } from './app';
import { DataCenterScraper } from './service/datacenter';
import { JDpower } from './service/jdpower';
import { KBB, Transmission } from './service/kbb';

async function scrapeJDPower() {
  const jdpower = new JDpower('WMWLV7C00L2L81812');
  const data = await jdpower.getData();
  const result = jdpower.parseText(data);
  console.log(result);
  await jdpower.exit();
}
async function scrapeKBB() {
  const kbb = new KBB(
    '1G1FE1R70K0156326',
    Transmission.manual,
    100000,
    '62298',
  );
  const data = await kbb.getData();
}
async function scrapeDataCenter() {
  const scraper = new DataCenterScraper();
  const page = await scraper.openScraper();
  await scraper.login(page);
  // const data = await scraper.getData(page);
  // const result = scraper.anaylzeContent(data);
  // console.log('HERE', JSON.stringify(result, null, 2));
}
// scrapeKBB();
// scrapeJDPower();
// scrapeDataCenter();
init().then(() => {
  app.listen(3000, () => {
    console.log('App successfully started.')
  });
})

