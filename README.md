# Scrape Engine

Automated auction file monitoring and Dealer Center synchronization system. Monitors Google Drive folders for Adesa and Edge Pipeline auction files, processes vehicle data, and syncs updates to Dealer Center via Puppeteer.

## Features

- 🔄 **Automated Monitoring**: Monitors Google Drive folders on scheduled auction weeks
- 📊 **File Processing**: Parses CSV and Google Sheets files for vehicle data
- 🔁 **Job Queue System**: Uses Redis and BullMQ for reliable job processing
- 🤖 **DC Sync**: Automatically syncs vehicle data to Dealer Center via Puppeteer
- 🔔 **Alerts**: Telegram notifications for failures and system health
- 🚫 **Blocked VINs**: Automatic blocking and management of problematic VINs

## Quick Start

### Prerequisites

- Node.js 18+
- Redis server
- PostgreSQL database (with Prisma)
- Google Cloud Console project with Drive/Sheets API enabled
- Telegram bot token (optional, for alerts)
- Google Chrome with custom profile configured:
  - Fork/copy Chrome profile locally
  - Install Proxy Omega 3 extension
  - Configure proxy forwarding for `dealercenter.net`
  - Launch Chrome with remote debugging on port `19203`

### Installation

```bash
npm install
npx prisma generate
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Database
DATABASE_URL="postgresql://..."

# Google Drive OAuth
GOOGLE_OAUTH_CLIENT_ID=your_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/oauth2callback
GOOGLE_OAUTH_REFRESH_TOKEN=your_refresh_token

# Google Drive Folders
GOOGLE_DRIVE_ADESA_FOLDER_ID=your_adesa_folder_id
GOOGLE_DRIVE_EDGE_FOLDER_ID=your_edge_folder_id

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Telegram (optional)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_channel_chat_id   # channel, e.g. -1001234567890 or @your_channel_username

# Optional settings
POLL_INTERVAL_MS=300000  # Default: 5 minutes
CUTOFF_TIME_HOURS=12     # Default: 12 PM
```

See [Setup Guide](./docs/SETUP.md) for detailed configuration instructions.

### Running

**Development:**
```bash
# 1. Start Chrome with remote debugging (required for DC sync)
# See Setup Guide for Chrome configuration
npm run chrome:start
# Equivalent to: google-chrome --user-data-dir=./.chrome-profile-dc --remote-debugging-port=19203
# Override with CHROME_PROFILE_DIR / CHROME_DEBUG_PORT / CHROME_BIN env vars

# 2. Run all workers in parallel
npm run dev:start

# Or run individually
npm run dev:monitor      # Auction monitor
npm run dev:dc-sync      # DC sync worker (requires Chrome running)
npm run dev:telegram     # Telegram alerts
npm run dev:dashboard    # Queue dashboard
```

**Production:**
```bash
npm run build
npm run prod:start
```

**With PM2:**
```bash
npm run build
pm2 start ecosystem.config.js
pm2 logs
```

## How It Works

### Monitoring Schedule

**Adesa Auction (Wednesdays):**
- Starts: Friday before auction
- Ends: Wednesday at 12 PM
- File format: `adesa-MM-DD-YYYY.csv`

**Edge Auction (Thursdays):**
- Starts: Monday of auction week
- Ends: Thursday (end of day)
- File format: `edge-MM-DD-YYYY.csv`

### Processing Flow

1. **Monitor** detects auction files in Google Drive folders
2. **Parser** extracts vehicle data (VIN, odometer, notes, etc.)
3. **Detector** identifies new VINs vs. existing (changes only)
4. **Queue** enqueues jobs for records needing DC sync
5. **Worker** processes jobs sequentially (Puppeteer updates DC)
6. **Database** stores results after successful DC update

### File Processing

- **New VINs**: Full import, new appraisal created
- **Existing VINs**: Only changed records appended (no overwrite)
- **No Changes**: Skipped to avoid duplicates
- **Blocked VINs**: Automatically skipped until unblocked

## Workers

### Auction Monitor (`auctionMonitor.ts`)
- Monitors Google Drive folders on schedule
- Parses auction files
- Enqueues DC update jobs
- Saves DB-only records directly

### DC Sync Worker (`dcSyncWorker.ts`)
- Processes jobs from BullMQ queue
- Updates Dealer Center via Puppeteer
- Saves results to database
- Retries failed jobs (3 attempts with exponential backoff)

> ⚠️ Only one DC sync worker should run at a time (sequential processing required for Puppeteer stability)

### Telegram Worker (`telegramWorker.ts`)
- Sends alerts for job failures
- Monitors queue health
- Reports system status

## Blocked VINs

When a VIN encounters an uncovered case (e.g., unimplemented question type), it's automatically blocked:

1. VIN added to blocked list (Redis)
2. Telegram alert sent with details
3. Future processing skipped until manually unblocked

### Management

```bash
# List all blocked VINs
npx ts-node src/scripts/manageBlockedVins.ts list

# View details for a VIN
npx ts-node src/scripts/manageBlockedVins.ts view <VIN>

# Unblock a VIN (after fixing the issue)
npx ts-node src/scripts/manageBlockedVins.ts unblock <VIN>
```

## Testing

```bash
# Test Google Drive CSV reading
dotenv -e .env -- npx ts-node src/scripts/test-google-drive-csv.ts

# Test string similarity utilities
npm run test:stringSimilarity
```

## Scripts

- `src/scripts/get-google-oauth-tokens.ts` - Generate OAuth refresh token
- `src/scripts/list-google-drive-files.ts` - List Drive folder contents
- `src/scripts/manageBlockedVins.ts` - Manage blocked VINs
- `src/scripts/test-google-drive-csv.ts` - Test CSV parsing
- `src/scripts/test-adjust-filters.ts` - Debug auction filter tuning for a VIN (update the `TEST_VIN` placeholder inside the script or set the `TEST_VIN` environment variable before running)

Example:

```bash
TEST_VIN=1G1FE1R70K0156326 TEST_FILTER_STRATEGY=weighted \
  dotenv -e .env -- ts-node src/scripts/test-adjust-filters.ts
```

## Documentation

- [Setup Guide](./docs/SETUP.md) - Detailed setup and configuration
- [API Documentation](./docs/API.md) - Internal API endpoints used
- [Architecture](./docs/ARCHITECTURE.md) - System architecture overview
- [DC Update Process](./docs/updateAuction.md) - Dealer Center update flow

## License

MIT

