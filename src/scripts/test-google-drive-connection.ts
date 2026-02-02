import { loadEnvConfig } from '../config/env.config';
import { listFilesInFolder } from '../services/googledrive';
import { getGoogleOAuthToken } from '../storage/googleAuthDb';

/**
 * Test script to verify Google Drive connection
 * Tests both database token storage and API access
 */

async function main(): Promise<void> {
  loadEnvConfig();

  console.log('\n=== Google Drive Connection Test ===\n');

  try {
    // Check if token exists in database
    console.log('1. Checking database for OAuth token...');
    const dbToken = await getGoogleOAuthToken('google_drive');
    
    if (dbToken) {
      console.log('   ✅ Token found in database');
      console.log(`   - Service: ${dbToken.serviceName}`);
      console.log(`   - Has refresh token: ${!!dbToken.refreshToken}`);
      console.log(`   - Has access token: ${!!dbToken.accessToken}`);
      if (dbToken.expiresAt) {
        const now = new Date();
        const isExpired = dbToken.expiresAt <= now;
        console.log(`   - Access token status: ${isExpired ? '🔴 Expired' : '🟢 Valid'}`);
        console.log(`   - Expires at: ${dbToken.expiresAt.toISOString()}`);
      }
      console.log('');
    } else {
      console.log('   ⚠️  No token found in database');
      console.log('   Checking for GOOGLE_OAUTH_REFRESH_TOKEN in environment...');
      
      if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
        console.log('   ✅ Found in environment variable');
        console.log('   💡 Consider running: npx ts-node src/scripts/migrate-google-token-to-db.ts\n');
      } else {
        console.log('   ❌ No token found in environment either\n');
        console.log('   To set up Google OAuth, run:');
        console.log('   1. npx ts-node src/scripts/get-google-oauth-tokens.ts');
        console.log('   2. npx ts-node src/scripts/setup-google-oauth.ts\n');
        process.exitCode = 1;
        return;
      }
    }

    // Test API access
    console.log('2. Testing Google Drive API access...');
    const testFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || 
                         process.env.ADESA_FOLDER_ID || 
                         process.env.EDGEPIPELINE_FOLDER_ID;
    
    if (!testFolderId) {
      console.log('   ⚠️  No folder ID found in environment variables');
      console.log('   (Set GOOGLE_DRIVE_FOLDER_ID, ADESA_FOLDER_ID, or EDGEPIPELINE_FOLDER_ID to test)\n');
      console.log('   Testing without listing files...');
      console.log('   ✅ Google Drive service initialized successfully\n');
      return;
    }

    console.log(`   Testing with folder: ${testFolderId}`);
    const files = await listFilesInFolder(testFolderId, 5);
    
    console.log(`   ✅ Successfully connected to Google Drive`);
    console.log(`   - Found ${files.length} files (showing up to 5):`);
    
    files.forEach(file => {
      console.log(`     • ${file.name} (${file.mimeType})`);
    });
    
    console.log('\n✅ All tests passed! Google Drive is configured correctly.\n');

  } catch (error) {
    console.error('\n❌ Connection test failed:\n');
    
    if (error instanceof Error) {
      console.error(error.message);
      
      // Provide helpful error messages
      if (error.message.includes('invalid_grant')) {
        console.error('\n💡 The refresh token is invalid or expired.');
        console.error('   To regrant access:');
        console.error('   1. Revoke access at: https://myaccount.google.com/permissions');
        console.error('   2. Run: npx ts-node src/scripts/get-google-oauth-tokens.ts');
        console.error('   3. Run: npx ts-node src/scripts/setup-google-oauth.ts\n');
      } else if (error.message.includes('Invalid Credentials')) {
        console.error('\n💡 Check your CLIENT_ID and CLIENT_SECRET in .env');
      } else if (error.message.includes('File not found') || error.message.includes('notFound')) {
        console.error('\n💡 The folder ID might be incorrect or you don\'t have access to it');
      }
      
      if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
    } else {
      console.error(error);
    }
    
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
