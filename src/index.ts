import app, { init } from './app';
import { DataCenterScraper } from './services/datacenter';
import { loadEnvConfig } from './config/env.config';

// Load environment configuration once for the main HTTP server
loadEnvConfig();


init().then(async () => {
  // await scrapeDataCenter();
  app.listen(10003, () => {
    console.log(
      'App successfully started. HTTP server listening on http://localhost:10003',
    );
  });
});
