import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

/**
 * Google Drive File Listing Script
 * 
 * Based on: https://developers.google.com/identity/protocols/oauth2
 * 
 * This script uses OAuth 2.0 refresh tokens to access Google Drive API.
 * Handles refresh token expiration gracefully as per OAuth 2.0 best practices.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

type DriveFile = Pick<
  drive_v3.Schema$File,
  'id' | 'name' | 'mimeType' | 'modifiedTime' | 'size' | 'webViewLink'
>;

function getEnvVar(key: string): string {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function getOAuthClient(): OAuth2Client {
  const clientId = getEnvVar('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = getEnvVar('GOOGLE_OAUTH_CLIENT_SECRET');
  const redirectUri = getEnvVar('GOOGLE_OAUTH_REDIRECT_URI');
  const refreshToken = getEnvVar('GOOGLE_OAUTH_REFRESH_TOKEN');

  const oAuth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
  oAuth2Client.setCredentials({ refresh_token: refreshToken });

  return oAuth2Client;
}

async function getDriveClient(): Promise<drive_v3.Drive> {
  const auth = getOAuthClient();
  
  try {
    const accessTokenResponse = await auth.getAccessToken();

    const token =
      typeof accessTokenResponse === 'string'
        ? accessTokenResponse
        : accessTokenResponse?.token ?? null;

    if (!token) {
      throw new Error('Unable to obtain an access token for Google Drive');
    }

    const tokenInfo = await auth.getTokenInfo(token);
    const grantedScopes = tokenInfo.scopes ?? [];
    const missingScopes = SCOPES.filter((scope) => !grantedScopes.includes(scope));

    if (missingScopes.length > 0) {
      throw new Error(
        `OAuth2 credentials are missing required scopes: ${missingScopes.join(
          ', '
        )}`
      );
    }

    return google.drive({ version: 'v3', auth });
  } catch (error: any) {
    // Handle refresh token expiration scenarios
    // Reference: https://developers.google.com/identity/protocols/oauth2#5.-refresh-the-access-token,-if-necessary
    if (error?.response?.data?.error === 'invalid_grant') {
      const errorData = error.response.data;
      let errorMessage = '\n❌ Refresh token has expired or been revoked.\n';
      errorMessage += '\nThis can happen if:\n';
      errorMessage += '  • The refresh token has not been used for 6 months\n';
      errorMessage += '  • The user revoked access\n';
      errorMessage += '  • The user changed their password (for Gmail scopes)\n';
      errorMessage += '  • Maximum of 100 refresh tokens per Google Account reached\n';
      errorMessage += '  • Session control policy expired (for GCP organizations)\n';
      
      if (errorData.error_subtype === 'invalid_rapt') {
        errorMessage += '\n⚠️  Session control policy has expired. User needs to re-authenticate.\n';
      }
      
      errorMessage += '\nTo fix this, run the authorization script again:\n';
      errorMessage += '  dotenv -e .env -- npx ts-node src/scripts/get-google-oauth-tokens.ts\n';
      
      throw new Error(errorMessage);
    }
    throw error;
  }
}

export async function listFilesInFolder(
  folderId: string,
  pageSize = 100
): Promise<DriveFile[]> {
  const drive = await getDriveClient();

  let pageToken: string | undefined;
  const files: DriveFile[] = [];

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields:
        'nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)',
      orderBy: 'folder,name',
      pageSize,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    files.push(...(response.data.files ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
}

async function main(): Promise<void> {
  const [, , folderId, outputFormat = 'table'] = process.argv;

  if (!folderId) {
    console.error('Usage: ts-node src/scripts/list-google-drive-files.ts <folderId> [table|json]');
    process.exitCode = 1;
    return;
  }

  try {
    const files = await listFilesInFolder(folderId);

    if (outputFormat === 'json') {
      console.log(JSON.stringify(files, null, 2));
      return;
    }

    if (files.length === 0) {
      console.log(`Folder ${folderId} is empty or you do not have access.`);
      return;
    }

    console.table(
      files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        size: file.size,
        webViewLink: file.webViewLink,
      }))
    );
  } catch (error) {
    console.error('Failed to list Google Drive files\n');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Unknown error:', error);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

