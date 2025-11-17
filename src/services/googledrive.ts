import { google, drive_v3, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

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
      `OAuth2 credentials are missing required scopes: ${missingScopes.join(', ')}`
    );
  }

  return google.drive({ version: 'v3', auth });
}

/**
 * Gets a Google Sheets API client
 */
async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const auth = getOAuthClient();
  const accessTokenResponse = await auth.getAccessToken();

  const token =
    typeof accessTokenResponse === 'string'
      ? accessTokenResponse
      : accessTokenResponse?.token ?? null;

  if (!token) {
    throw new Error('Unable to obtain an access token for Google Sheets');
  }

  const tokenInfo = await auth.getTokenInfo(token);
  const grantedScopes = tokenInfo.scopes ?? [];
  const missingScopes = SCOPES.filter((scope) => !grantedScopes.includes(scope));

  if (missingScopes.length > 0) {
    throw new Error(
      `OAuth2 credentials are missing required scopes: ${missingScopes.join(', ')}`
    );
  }

  return google.sheets({ version: 'v4', auth });
}

/**
 * Lists all files in a Google Drive folder
 */
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

/**
 * Finds a file by name pattern in a Google Drive folder
 */
export async function findFileByName(
  folderId: string,
  fileNamePattern: string | RegExp
): Promise<DriveFile | null> {
  const files = await listFilesInFolder(folderId);
  
  if (typeof fileNamePattern === 'string') {
    return files.find((f) => f.name === fileNamePattern) ?? null;
  }
  
  return files.find((f) => f.name && fileNamePattern.test(f.name)) ?? null;
}

/**
 * Downloads a file from Google Drive
 */
export async function downloadFile(
  fileId: string,
  outputPath?: string
): Promise<Buffer> {
  const drive = await getDriveClient();
  
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  const chunks: Uint8Array[] = [];
  
  return new Promise((resolve, reject) => {
    response.data
      .on('data', (chunk: Uint8Array) => chunks.push(chunk))
      .on('end', () => {
        const buffer = Buffer.from(Buffer.concat(chunks));
        if (outputPath) {
          fs.writeFileSync(outputPath, buffer);
        }
        resolve(buffer);
      })
      .on('error', reject);
  });
}

/**
 * Downloads a file and saves it to a temporary directory
 */
export async function downloadFileToTemp(
  fileId: string,
  fileName: string
): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const outputPath = path.join(tempDir, fileName);
  await downloadFile(fileId, outputPath);
  return outputPath;
}

/**
 * Reads a Google Sheets file using the Sheets API and converts to CSV format
 * This is more reliable than exporting via Drive API
 */
export async function readGoogleSheetAsCSV(fileId: string, sheetName?: string): Promise<string> {
  const sheets = await getSheetsClient();
  
  try {
    // Get the spreadsheet metadata to find the sheet name if not provided
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: fileId,
    });

    const targetSheetName = sheetName || spreadsheet.data.sheets?.[0]?.properties?.title || 'Sheet1';
    
    // Read the sheet data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: fileId,
      range: targetSheetName,
    });

    const values = response.data.values;
    
    if (!values || values.length === 0) {
      return '';
    }

    // Convert to CSV format
    const csvRows = values.map(row => {
      // Escape cells that contain commas, quotes, or newlines
      return row.map(cell => {
        const cellValue = (cell ?? '').toString();
        if (cellValue.includes(',') || cellValue.includes('"') || cellValue.includes('\n')) {
          return `"${cellValue.replace(/"/g, '""')}"`;
        }
        return cellValue;
      }).join(',');
    });

    return csvRows.join('\n');
  } catch (error: any) {
    // Fallback to Drive API export if Sheets API fails
    console.warn('Sheets API failed, falling back to Drive API export:', error.message);
    return exportGoogleSheetAsCSV(fileId);
  }
}

/**
 * Exports a Google Sheets file as CSV using Drive API (fallback method)
 */
export async function exportGoogleSheetAsCSV(fileId: string): Promise<string> {
  const drive = await getDriveClient();
  
  const response = await drive.files.export(
    {
      fileId,
      mimeType: 'text/csv',
    },
    { responseType: 'stream' }
  );

  const chunks: Uint8Array[] = [];
  
  return new Promise((resolve, reject) => {
    response.data
      .on('data', (chunk: Uint8Array) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.from(Buffer.concat(chunks)).toString('utf-8')))
      .on('error', reject);
  });
}

/**
 * Gets file information from Google Drive
 */
export async function getFileInfo(fileId: string): Promise<DriveFile> {
  const drive = await getDriveClient();
  
  const response = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, modifiedTime, size, webViewLink',
    supportsAllDrives: true,
  });

  const file = response.data;
  
  if (!file.id || !file.name) {
    throw new Error(`Invalid file response for file ID: ${fileId}`);
  }

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType || 'unknown',
    modifiedTime: file.modifiedTime || undefined,
    size: file.size || undefined,
    webViewLink: file.webViewLink || undefined,
  };
}

