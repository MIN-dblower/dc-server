import { DCEngine } from '@services/dcengine';
import { Page } from 'puppeteer';

const MAX_LOGIN_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // 2 seconds between retries

/**
 * Attempts to login with retry logic
 */
async function attemptLoginWithRetry(
  dcEngine: DCEngine,
  page: Page,
  maxAttempts: number = MAX_LOGIN_RETRIES,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`\n🔄 Login attempt ${attempt}/${maxAttempts}...`);
      
      await dcEngine.forceLogin(page);
      
      // Try to get token after login
      const token = await dcEngine.getToken(page);
      
      if (token) {
        console.log(`✅ Login successful on attempt ${attempt}`);
        return token;
      } else {
        throw new Error('Failed to retrieve token after login');
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`❌ Login attempt ${attempt} failed:`, lastError.message);
      
      if (attempt < maxAttempts) {
        console.log(`⏳ Waiting ${RETRY_DELAY_MS}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  // All attempts failed
  throw new Error(
    `Login failed after ${maxAttempts} attempts. Last error: ${lastError?.message || 'Unknown error'}`,
  );
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('DealerCenter Login Test');
  console.log('='.repeat(60));
  console.log('');

  const dcEngine = new DCEngine();
  const page = await dcEngine.openScraper();

  try {
    console.log('Step 1: Checking for existing token...');
    let token = await dcEngine.getToken(page);
    
    if (token) {
      console.log('✓ Found existing valid token');
      console.log(`Token (first 20 chars): ${token.substring(0, 20)}...`);
      dcEngine.setToken(token);
    } else {
      console.log('✗ No valid token found');
      console.log('');
      console.log('Step 2: Attempting interactive login with retry logic...');
      console.log(`   Max retries: ${MAX_LOGIN_RETRIES}`);
      console.log(`   Retry delay: ${RETRY_DELAY_MS}ms`);
      
      token = await attemptLoginWithRetry(dcEngine, page, MAX_LOGIN_RETRIES);
      
      console.log('✓ Token obtained after login');
      console.log(`Token (first 20 chars): ${token.substring(0, 20)}...`);
      dcEngine.setToken(token);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Login Test Summary');
    console.log('='.repeat(60));
    console.log(`Token Status: ${token ? '✓ Valid' : '✗ Invalid'}`);
    console.log(`Authentication: ${token ? '✓ Authenticated' : '✗ Not Authenticated'}`);
    if (token) {
      console.log(`Token length: ${token.length} characters`);
    }
    const currentUrl = await page.url();
    console.log(`Final URL: ${currentUrl}`);
    console.log('='.repeat(60));
    console.log('');
    
    if (token) {
      console.log('✓ Login test completed successfully');
    } else {
      throw new Error('Login failed - no token obtained');
    }
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('❌ Error during login test');
    console.error('='.repeat(60));
    console.error('');
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      if (error.stack) {
        console.error('');
        console.error('Stack trace:');
        console.error(error.stack);
      }
    } else {
      console.error('Unknown error:', error);
    }
    throw error;
  } finally {
    await dcEngine.close();
    console.log('');
    console.log('Browser closed.');
  }
}

main().catch(console.error);

