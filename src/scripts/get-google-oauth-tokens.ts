import { google } from 'googleapis';
import * as readline from 'readline';

/**
 * OAuth 2.0 Authorization Script for Google Drive API
 * 
 * Based on: https://developers.google.com/identity/protocols/oauth2
 * 
 * This script implements the OAuth 2.0 authorization code flow for server-side applications.
 * For server-side scripts, use the "Web application" client type in Google Cloud Console.
 * 
 * Reference: https://developers.google.com/identity/protocols/oauth2/web-server
 */

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

function getEnvVar(key: string): string {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

function validateCredentials(clientId: string, clientSecret: string, redirectUri: string): void {
  if (!clientId || clientId.trim() === '') {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID is empty');
  }

  if (!clientSecret || clientSecret.trim() === '') {
    throw new Error('GOOGLE_OAUTH_CLIENT_SECRET is empty');
  }

  if (!redirectUri || redirectUri.trim() === '') {
    throw new Error('GOOGLE_OAUTH_REDIRECT_URI is empty');
  }

  // Validate client ID format (should end with .apps.googleusercontent.com)
  if (!clientId.includes('.apps.googleusercontent.com')) {
    console.warn(
      '⚠️  Warning: Client ID format looks unusual. Make sure you copied the full Client ID from Google Cloud Console.'
    );
  }

  // Common redirect URI issues
  if (redirectUri.includes('localhost') && !redirectUri.startsWith('http://localhost')) {
    throw new Error(
      'Redirect URI must start with http://localhost (not https://localhost)'
    );
  }
}

async function main(): Promise<void> {
  try {
    const clientId = getEnvVar('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = getEnvVar('GOOGLE_OAUTH_CLIENT_SECRET');
    let redirectUri = getEnvVar('GOOGLE_OAUTH_REDIRECT_URI');

    // Validate credentials
    validateCredentials(clientId, clientSecret, redirectUri);

    // For Desktop apps, use the out-of-band redirect URI
    // Check if user might be using Desktop app credentials
    if (redirectUri === 'urn:ietf:wg:oauth:2.0:oob' || redirectUri === 'oob') {
      redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
      console.log('ℹ️  Using Desktop app OAuth flow (out-of-band)\n');
    }

    console.log('\n=== Google OAuth2 Authorization ===\n');
    console.log('Client ID:', clientId.substring(0, 20) + '...');
    console.log('Redirect URI:', redirectUri);
    console.log('');

    const oAuth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    // Generate the authorization URL
    // Following OAuth 2.0 best practices from:
    // https://developers.google.com/identity/protocols/oauth2
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline', // Request refresh token
      scope: SCOPES,
      prompt: 'consent', // Force consent screen to ensure refresh token is returned
      // Note: Authorization codes expire quickly, so users should paste the code immediately
    });

    console.log('1. Open the following URL in your browser:');
    console.log('\n' + authUrl + '\n');
    
    if (redirectUri === 'urn:ietf:wg:oauth:2.0:oob') {
      console.log('2. After authorization, Google will show you an authorization code.');
      console.log('3. Copy that code and paste it below.\n');
    } else {
      console.log('2. After authorization, you will be redirected to:');
      console.log('   ' + redirectUri);
      console.log('3. Copy the "code" parameter from the URL and paste it below.\n');
      console.log('   Example: If redirected to:');
      console.log('   ' + redirectUri + '?code=4/0Aean...');
      console.log('   Copy: 4/0Aean...\n');
    }

    // Try to open the browser automatically (optional)
    try {
      const { exec } = require('child_process');
      const platform = process.platform;
      let command: string;

      if (platform === 'darwin') {
        command = 'open';
      } else if (platform === 'win32') {
        command = 'start';
      } else {
        command = 'xdg-open';
      }

      exec(`${command} "${authUrl}"`, (error: Error | null) => {
        if (error) {
          // Silently fail if browser can't be opened
        }
      });
    } catch {
      // Ignore errors
    }

    const rl = createReadlineInterface();
    const code = await question(rl, 'Enter the authorization code: ');
    rl.close();

    if (!code || code.trim() === '') {
      console.error('No authorization code provided.');
      process.exitCode = 1;
      return;
    }

    // Exchange the authorization code for tokens
    console.log('\nExchanging authorization code for tokens...\n');
    
    let tokens;
    try {
      const tokenResponse = await oAuth2Client.getToken(code.trim());
      tokens = tokenResponse.tokens;
    } catch (error: any) {
      console.error('\n❌ Failed to exchange authorization code for tokens\n');
      
      if (error.response?.data) {
        const errorData = error.response.data;
        console.error('Error details:', JSON.stringify(errorData, null, 2));
        
        if (errorData.error === 'invalid_client') {
          console.error('\n🔍 "invalid_client" error troubleshooting:\n');
          console.error('1. Check that your Client ID and Client Secret are correct');
          console.error('   - Go to: https://console.cloud.google.com/apis/credentials');
          console.error('   - Verify the Client ID matches exactly (no extra spaces)');
          console.error('   - Verify the Client Secret matches exactly\n');
          
          console.error('2. Check that your Redirect URI matches EXACTLY:');
          console.error('   - Current redirect URI:', redirectUri);
          console.error('   - In Google Cloud Console, go to your OAuth 2.0 Client');
          console.error('   - Under "Authorized redirect URIs", ensure this URI is listed');
          console.error('   - The URI must match character-for-character (including http vs https)\n');
          
          console.error('3. OAuth Client Type mismatch:');
          console.error('   - If you created a "Desktop app" client, use redirect URI:');
          console.error('     urn:ietf:wg:oauth:2.0:oob');
          console.error('   - If you created a "Web application" client, use a URL like:');
          console.error('     http://localhost:3000/oauth2callback');
          console.error('   - Make sure the redirect URI in .env matches what\'s in Google Cloud Console\n');
        } else if (errorData.error === 'invalid_grant') {
          console.error('\n🔍 "invalid_grant" error troubleshooting:\n');
          console.error('   - The authorization code may have expired (codes expire quickly)');
          console.error('   - The authorization code may have already been used');
          console.error('   - Try running the script again to get a fresh authorization code\n');
          
          // Check for refresh token expiration scenarios
          if (errorData.error_subtype) {
            console.error('   Error subtype:', errorData.error_subtype);
            if (errorData.error_subtype === 'invalid_rapt') {
              console.error('   - Session control policy may have expired');
              console.error('   - User needs to re-authenticate\n');
            }
          }
        }
      } else if (error.message) {
        console.error('Error message:', error.message);
      } else {
        console.error('Unknown error:', error);
      }
      
      throw error;
    }

    if (!tokens.refresh_token) {
      console.error(
        '\n⚠️  WARNING: No refresh token received. This may happen if:'
      );
      console.error('   - You have already authorized this app before');
      console.error('   - The OAuth client is configured incorrectly');
      console.error(
        '\nTry revoking access at: https://myaccount.google.com/permissions'
      );
      console.error('Then run this script again.\n');
    }

    console.log('✅ Successfully obtained tokens!\n');
    console.log('=== Add these to your .env file ===\n');
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token || 'NOT_PROVIDED'}\n`);

    if (tokens.access_token) {
      console.log('Access token (for testing):');
      console.log(tokens.access_token.substring(0, 20) + '...\n');
    }

    if (tokens.refresh_token) {
      console.log('✅ Refresh token obtained! Save it to your .env file.\n');
      console.log('📝 Important notes about refresh tokens:');
      console.log('   - Refresh tokens can expire if:');
      console.log('     • Not used for 6 months');
      console.log('     • User revokes access');
      console.log('     • User changes password (for Gmail scopes)');
      console.log('     • Maximum of 100 refresh tokens per Google Account per OAuth client');
      console.log('   - Handle token refresh errors gracefully in your application');
      console.log('   - Reference: https://developers.google.com/identity/protocols/oauth2#5.-refresh-the-access-token,-if-necessary\n');
    } else {
      console.log('⚠️  No refresh token - you may need to revoke and re-authorize.\n');
      console.log('   Revoke access at: https://myaccount.google.com/permissions\n');
    }
  } catch (error) {
    console.error('\n❌ Failed to obtain OAuth tokens\n');
    if (error instanceof Error) {
      console.error('Error:', error.message);
      if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
    } else {
      console.error('Unknown error:', error);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}




