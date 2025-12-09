/**
 * Environment Configuration
 * 
 * Loads environment variables from .env files using dotenv library.
 * - production: .env.production
 * - development or default: .env.development
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

/**
 * Load environment variables from the appropriate .env file
 */
export function loadEnvConfig(): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  
  // Determine which .env file to load
  const envFile = isProduction ? '.env.production' : '.env.development';
  const envPath = path.resolve(process.cwd(), envFile);
  
  // Load the environment file
  const result = dotenv.config({ path: envPath });
  
  if (result.error) {
    console.warn(
      `⚠️  Could not load ${envFile} (${result.error.message}). ` +
      `Falling back to system environment variables.`
    );
  } else {
    console.log(`✅ Loaded environment from ${envFile}`);
  }
  
  // Also load .env as fallback (for shared variables that should be the same in all environments)
  // This allows .env to override or provide defaults (override: false means existing vars won't be overwritten)
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });
}

