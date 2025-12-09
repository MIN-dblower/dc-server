import { DCEngine } from '@services/dcengine';

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
      console.log('Step 2: Attempting interactive login...');
      
      await dcEngine.forceLogin(page);
      
      console.log('Step 3: Retrieving token after login...');
      token = await dcEngine.getToken(page);
      
      if (!token) {
        throw new Error(
          'Failed to retrieve DealerCenter token after login attempt.',
        );
      }
      
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

