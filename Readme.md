# PROCESS

1. Check Vin Duplicate
   https://app.dealercenter.net/api-gateway/inventory/Inventory/CheckVinDuplicate
   IN

   ```json
   {
     "vin": "1G1FE1R70K0156326",
     "companyId": null
   }
   ```

   OUT

   ```json
   {
     "inventoryId": "924abd80-3808-4510-b8a4-08dd2fac24c2",
     "inventoryStatusId": 0,
     "companyId": "55b0c719-88fc-4575-8ff9-bfabc0114321",
     "companyName": "Springer Automotive Group Inc",
     "vin": "1G1FE1R70K0156326"
   }
   ```

2. In case already in

https://app.dealercenter.net/api-gateway/inventory/Inventory/LoadInventoryById
IN

```json
{
  "inventoryId": "924abd80-3808-4510-b8a4-08dd2fac24c2",
  "loadOption": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 16, 11],
  "setIsCurrentForBook": false
}
```

you can obtain the builds data

Get History

## Google Drive Utilities

Based on [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)

### Setup OAuth2 Credentials

1. **Create OAuth2 Client in Google Cloud Console:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create or select a project
   - Enable the **Google Drive API** and **Google Sheets API**
   - Go to "APIs & Services" > "Credentials"
   - Create OAuth 2.0 Client ID
   - **For server-side scripts, use "Web application" client type** (as per [Google's documentation](https://developers.google.com/identity/protocols/oauth2))
     - Application type: **"Web application"**
     - Add authorized redirect URI: `http://localhost:3000/oauth2callback`
     - In `.env`, set: `GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/oauth2callback`
     - ⚠️ **Important:** The redirect URI in `.env` must match EXACTLY what you entered in Google Cloud Console
   
   **Note:** According to Google's documentation, "For server-side or JavaScript web apps use the Web application client type. Don't use this client type for any other application, such as native or mobile apps."

   - Copy the Client ID and Client Secret

2. **Set initial environment variables in `.env`:**
   ```bash
   GOOGLE_OAUTH_CLIENT_ID=your_client_id_here
   GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret_here
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/oauth2callback
   ```

   **⚠️ Troubleshooting "invalid_client" error:**
   - Ensure the redirect URI in `.env` matches EXACTLY what's configured in Google Cloud Console
   - Check for extra spaces or typos in Client ID and Client Secret
   - Verify you're using "Web application" client type for server-side scripts
   - The script will display detailed error messages to help diagnose the issue

3. **Get the refresh token:**
   ```bash
   dotenv -e .env -- npx ts-node src/scripts/get-google-oauth-tokens.ts
   ```
   This script will:
   - Open your browser to authorize the application
   - Ask you to paste the authorization code
   - Exchange it for tokens and display the refresh token
   - Copy the refresh token to your `.env` file

4. **Add the refresh token to `.env`:**
   ```bash
   GOOGLE_OAUTH_REFRESH_TOKEN=your_refresh_token_here
   ```

   **📝 Important notes about refresh tokens** (from [Google's documentation](https://developers.google.com/identity/protocols/oauth2#5.-refresh-the-access-token,-if-necessary)):
   - Refresh tokens can expire if:
     - Not used for 6 months
     - User revokes access
     - User changes password (for Gmail scopes)
     - Maximum of 100 refresh tokens per Google Account per OAuth client ID reached
     - Session control policy expired (for GCP organizations)
   - If a refresh token expires, you'll need to run the authorization script again
   - The scripts handle refresh token expiration gracefully and provide clear error messages

### List Files in Google Drive Folder

Run the script to list the contents of a Drive folder:

```bash
dotenv -e .env -- npx ts-node src/scripts/list-google-drive-files.ts <folderId>
```

Add `json` as an optional second argument to print structured JSON instead of a table.

## Auction File Monitoring System

The system automatically monitors Google Drive folders for Adesa and Edge Pipeline auction files based on predefined schedules.

### Configuration

Add the following environment variables to your `.env` file:

```bash
# Google Drive OAuth (required - see Google Drive Utilities section above)
# Note: The refresh token must include both Drive and Sheets API scopes
GOOGLE_OAUTH_CLIENT_ID=your_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/oauth2callback
GOOGLE_OAUTH_REFRESH_TOKEN=your_refresh_token

# Google Drive Folder IDs
GOOGLE_DRIVE_ADESA_FOLDER_ID=your_adesa_folder_id
GOOGLE_DRIVE_EDGE_FOLDER_ID=your_edge_folder_id

# Optional: Polling interval in milliseconds (default: 300000 = 5 minutes)
POLL_INTERVAL_MS=300000

# Optional: Cutoff time in hours (default: 12 = 12 PM)
CUTOFF_TIME_HOURS=12

# Redis (BullMQ job queue)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# BullMQ Dashboard (optional)
BULL_BOARD_PORT=3001
BULL_BOARD_USERNAME=admin
BULL_BOARD_PASSWORD=your_secure_password

# Telegram Bot (alerts)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Getting Folder IDs

1. Open the Google Drive folder in your browser
2. The folder ID is in the URL: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
3. Copy the folder ID and add it to your `.env` file

### Monitoring Schedule

**Adesa Auction (Runs on Wednesdays):**
- Monitoring starts: Friday before the Wednesday auction
- Monitoring ends: Wednesday at 12 PM (configurable via `CUTOFF_TIME_HOURS`)
- File naming: `adesa-MM-DD-YYYY.csv` (e.g., `adesa-11-12-2025.csv`)

**Edge Auction (Runs on Thursdays):**
- Monitoring starts: Monday of auction week
- Monitoring ends: Thursday (end of day)
- File naming: `edge-MM-DD-YYYY.csv` (e.g., `edge-11-13-2025.csv`)

### Running the Monitor

Start the auction monitor worker (producer) in one terminal:

```bash
dotenv -e .env -- npx ts-node src/workers/auctionMonitor.ts
```

Start the DC sync worker (consumer) in another terminal:

```bash
dotenv -e .env -- npx ts-node src/workers/dcSyncWorker.ts
```

> ⚠️ Only one DC sync worker should run at a time (it processes jobs sequentially).

The monitor will:
1. Check for active monitoring windows based on the current date
2. Look for the expected file in the appropriate Google Drive folder
3. Download and parse the file when found
4. Detect new VINs (import all data) and existing VINs (append only changed records)
5. Save records to the database
6. Enqueue updates for the DC sync worker

The DC sync worker will:
1. Process each VIN sequentially (BullMQ queue)
2. Call the DC update function (Puppeteer)
3. Save records to the database only after successful DC update
4. Retry failed jobs automatically (3 attempts, exponential backoff)
5. Send Telegram alerts on failure/health events

### File Processing Logic

- **New VINs**: All data is imported and a new appraisal is created
- **Existing VINs**: Only changed records are imported and appended to the existing appraisal (no overwrite)
- **No Changes**: Records are skipped to avoid duplicate processing
- **File Types**: Supports both CSV files and Google Sheets (automatically exported as CSV)

### Edge Cases

- The system handles non-standard auction dates (holidays, etc.) by calculating the next auction date dynamically
- Files are only processed once per monitoring window (tracked internally)
- If a file is not found, the monitor will continue checking at the configured interval
- The system gracefully handles Google Drive API errors and refresh token expiration

### Blocked VINs Management

When the system encounters an uncovered case in `completeVehicleBuild` (e.g., a question type that hasn't been implemented yet), it will:

1. **Block the VIN** - The VIN is automatically added to a blocked list in Redis
2. **Send Telegram Alert** - You'll receive a detailed alert with:
   - VIN number
   - Question details (key, type, book)
   - Vehicle trim
   - Full question object for debugging
3. **Skip Future Processing** - The VIN will be skipped in future processing attempts until manually unblocked

#### Managing Blocked VINs

Use the management script to view and unblock VINs:

```bash
# List all blocked VINs
npx ts-node src/scripts/manageBlockedVins.ts list

# View details for a specific VIN
npx ts-node src/scripts/manageBlockedVins.ts view <VIN>

# Unblock a VIN (after fixing the issue)
npx ts-node src/scripts/manageBlockedVins.ts unblock <VIN>
```

**Important**: Only unblock a VIN after you've:
1. Reviewed the question object from the Telegram alert
2. Implemented the missing case in `completeVehicleBuild`
3. Tested the implementation

#### How It Works

- **Detection**: When `completeVehicleBuild` hits an uncovered case (question type not handled), it throws an `UncoveredCaseError`
- **Blocking**: The VIN is immediately added to Redis with details about why it was blocked
- **Notification**: Telegram alert is sent with all relevant information
- **Prevention**: Before processing any VIN, the system checks if it's blocked and skips it if so

### Testing the System

Before running the full monitor, test that you can read files from both folders:

```bash
dotenv -e .env -- npx ts-node src/scripts/test-google-drive-csv.ts
```

This test script will:
- List all files in both Adesa and Edge Pipeline folders
- Test reading and parsing a CSV file from each folder
- Display sample records and validation results
- Check for duplicate VINs in the files

The script automatically detects:
- Regular CSV files (`.csv` extension)
- Google Sheets files (automatically converted to CSV)

### Manual File Processing

You can also process files manually using the file processor:

```typescript
import { processAuctionFile } from './services/auctionFileProcessor';

// Process a file from Google Drive
const result = await processAuctionFile(fileId, fileName, isGoogleSheet);
console.log(`New: ${result.newRecords.length}, Updated: ${result.updatedRecords.length}`);
```

### Job Queue Dashboard

The BullMQ dashboard provides a web interface to monitor and manage job queues. It's available at `http://localhost:3001/admin/queues` (or the port specified by `BULL_BOARD_PORT`).

**Authentication:**
- The dashboard is protected with Basic HTTP Authentication
- Set `BULL_BOARD_USERNAME` and `BULL_BOARD_PASSWORD` in your `.env` file
- If credentials are not set, the dashboard will be unprotected (development only)
- When accessing the dashboard, your browser will prompt for username and password

**Starting the Dashboard:**
```bash
# Development
npm run dev:dashboard

# Production
npm run prod:dashboard
```

### PM2 Deployment

After building the project, you can run all workers via the provided PM2 ecosystem file:

```bash
# Build TypeScript → dist JS
npm run build

# Start monitor, DC sync worker, and dashboard together
pm2 start ecosystem.config.js

# View logs
pm2 logs drive-monitor
pm2 logs dc-sync
pm2 logs queue-dashboard

# Persist processes across restarts
pm2 save
```
