import app from './app';
import { loadEnvConfig } from './config/env.config';

// Load environment configuration once for the main HTTP server
loadEnvConfig();
const PORT = process.env.BULL_BOARD_PORT
  ? parseInt(process.env.BULL_BOARD_PORT, 10)
  : 3001;



app.listen(PORT, () => {
  console.log(
    `App successfully started. HTTP server listening on http://localhost: ${PORT}`,
  );
});
