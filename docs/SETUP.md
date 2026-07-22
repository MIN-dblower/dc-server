# Setup Guide

Complete setup instructions for the Scrape Engine system.

## Prerequisites

- Node.js 18 or higher
- Redis Cloud database (or local Redis for development)
- PostgreSQL database
- Google Cloud Console account
- Telegram account (optional, for alerts)
- Google Chrome browser

## 1. Chrome Browser Setup

The DC sync worker connects to a running Chrome browser instance via Puppeteer. You need to set up Chrome with a custom profile and proxy configuration.

### Step 1: Fork Chrome Profile Locally

1. Create a directory for the Chrome profile (e.g., `~/chrome-profile-dc` or `C:\chrome-profile-dc`)

2. Copy an existing Chrome profile or create a new one:
   ```bash
   # Linux/macOS
   mkdir -p ~/chrome-profile-dc
   
   # Windows
   mkdir C:\chrome-profile-dc
   ```

### Step 2: Install Proxy Omega 3 Extension

1. Download Proxy Omega 3 extension:
   - Visit Chrome Web Store or get the extension file
   - Extension ID: Look for "Proxy Omega" in Chrome Web Store

2. Install the extension in your Chrome profile:
   - Option A: Install via Chrome Web Store (recommended)
     - Open Chrome with your profile
     - Go to Chrome Web Store
     - Search for "Proxy Omega"
     - Install the extension
   
   - Option B: Load unpacked extension
     ```bash
     # Launch Chrome with your profile and load extension
     google-chrome --user-data-dir=~/chrome-profile-dc --load-extension=/path/to/proxy-omega
     ```

### Step 3: Configure Proxy Forwarding for dealercenter.net

1. Launch Chrome with your profile:
   ```bash
   # Linux
   google-chrome --user-data-dir=~/chrome-profile-dc
   
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --user-data-dir=~/chrome-profile-dc
   
   # Windows
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir=C:\chrome-profile-dc
   ```

2. Configure Proxy Omega 3:
   - Open Chrome extensions (`chrome://extensions/`)
   - Find Proxy Omega 3 extension
   - Click "Options" or "Configure"
   - Add forwarding rule:
     - **Domain/Pattern**: `dealercenter.net` or `*.dealercenter.net`
     - **Proxy Type**: Your proxy type (HTTP, SOCKS5, etc.)
     - **Proxy Host**: Your proxy server address
     - **Proxy Port**: Your proxy server port
     - Add authentication if required (username/password)
   - Save the configuration

### Step 4: Launch Chrome with Remote Debugging

Launch Chrome with remote debugging enabled on port `19203`:

```bash
# Linux
google-chrome --user-data-dir=~/chrome-profile-dc --remote-debugging-port=19203

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --user-data-dir=~/chrome-profile-dc --remote-debugging-port=19203

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir=C:\chrome-profile-dc --remote-debugging-port=19203
```

**Important:**
- Chrome must be running before starting the DC sync worker
- Keep Chrome running while the DC sync worker is active
- The DC sync worker connects to Chrome via `http://127.0.0.1:19203`
- Ensure no firewall is blocking port `19203`

### Verification

Verify Chrome is listening on port 19203:

```bash
# Linux/macOS
curl http://127.0.0.1:19203/json/version

# Should return Chrome version info
```

### Optional: Create Launch Script

Create a script to launch Chrome easily:

**Linux/macOS** (`start-chrome-dc.sh`):
```bash
#!/bin/bash
google-chrome --user-data-dir=~/chrome-profile-dc --remote-debugging-port=19203
```

**Windows** (`start-chrome-dc.bat`):
```batch
@echo off
"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir=C:\chrome-profile-dc --remote-debugging-port=19203
```

Make executable (Linux/macOS):
```bash
chmod +x start-chrome-dc.sh
```

## 2. Database Setup

1. Create a PostgreSQL database
2. Update `DATABASE_URL` in `.env`:
   ```bash
   DATABASE_URL="postgresql://user:password@localhost:5432/scrape_engine"
   ```
3. Run migrations:
   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

## 3. Google Drive OAuth Setup

### Step 1: Create OAuth2 Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable APIs:
   - **Google Drive API**
   - **Google Sheets API**
4. Go to "APIs & Services" > "Credentials"
5. Click "Create Credentials" > "OAuth 2.0 Client ID"
6. Choose application type: **"Web application"**
   - ⚠️ **Important**: Use "Web application" for server-side scripts (per Google's documentation)
7. Add authorized redirect URI: `http://localhost:3000/oauth2callback`
8. Copy the **Client ID** and **Client Secret**

### Step 2: Configure Environment Variables

Add to your `.env` file:

```bash
GOOGLE_OAUTH_CLIENT_ID=your_client_id_here
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret_here
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/oauth2callback
```

⚠️ **Important**: The redirect URI in `.env` must match EXACTLY what you configured in Google Cloud Console.

### Step 3: Get Refresh Token

Run the authorization script:

```bash
dotenv -e .env -- npx ts-node src/scripts/get-google-oauth-tokens.ts
```

This will:
1. Open your browser for authorization
2. Ask you to paste the authorization code from the URL
3. Exchange it for tokens
4. Display the refresh token

### Step 4: Add Refresh Token

Add the refresh token to `.env`:

```bash
GOOGLE_OAUTH_REFRESH_TOKEN=your_refresh_token_here
```

**Note**: Refresh tokens can expire if:
- Not used for 6 months
- User revokes access
- Maximum of 100 refresh tokens per Google Account per OAuth client ID reached
- Session control policy expired (for GCP organizations)

If expired, run the authorization script again.

## 4. Google Drive Folder IDs

1. Open the Google Drive folder in your browser
2. Copy the folder ID from the URL:
   ```
   https://drive.google.com/drive/folders/FOLDER_ID_HERE
                           ^^^^^^^^^^^^^^^^^^^^
   ```
3. Add to `.env`:
   ```bash
   GOOGLE_DRIVE_ADESA_FOLDER_ID=your_adesa_folder_id
   GOOGLE_DRIVE_EDGE_FOLDER_ID=your_edge_folder_id
   ```

### Verify Folders

Test that you can read files from both folders:

```bash
dotenv -e .env -- npx ts-node src/scripts/test-google-drive-csv.ts
```

Or list files in a folder:

```bash
dotenv -e .env -- npx ts-node src/scripts/list-google-drive-files.ts <folderId>
```

## 5. Redis Setup

BullMQ (the job queue) is backed by [Redis Cloud](https://redis.io/cloud/). Create a database there and use its connection string.

### Redis Cloud

1. Create a database in the [Redis Cloud console](https://app.redislabs.com/)
2. Copy the connection string it gives you (`redis://default:<password>@<host>:<port>`, or `rediss://...` if you enabled TLS on the database)

### Configuration

Add to `.env`:

```bash
REDIS_URL=redis://default:your_password@your-endpoint.redns.redis-cloud.com:12345
```

### Local Redis (development alternative)

For local development without Redis Cloud, install Redis and use the discrete vars instead:

```bash
# Ubuntu/Debian
sudo apt-get install redis-server
# macOS
brew install redis

redis-server
```

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=        # Optional
REDIS_USERNAME=        # Optional (Redis ACL)
REDIS_DB=0
REDIS_TLS=false
```

`REDIS_URL` takes precedence over the discrete vars when both are set.

## 6. Telegram Bot (Optional)

### Create Bot

1. Open [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow instructions
3. Copy the bot token

### Get Chat ID (Channel)

Alerts should go to a channel, not a single user's DM, so multiple people can see them.

1. Create a Telegram channel (or use an existing one)
2. Add your bot to the channel as an **administrator** (needs "Post Messages" permission)
3. Get the channel's chat ID:
   - Public channel: use `@your_channel_username` directly as `TELEGRAM_CHAT_ID` — no lookup needed
   - Private channel: post any message in the channel, then visit
     `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` and find `channel_post.chat.id`
     in the response. It will look like `-100XXXXXXXXXX`.

### Configuration

Add to `.env`:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_channel_chat_id_here   # e.g. -1001234567890 or @your_channel_username
```

## 7. Optional Settings

```bash
# Polling interval in milliseconds (default: 300000 = 5 minutes)
POLL_INTERVAL_MS=300000

# Cutoff time in hours (default: 12 = 12 PM)
CUTOFF_TIME_HOURS=12
```

## 8. Verify Setup

1. **Test database connection:**
   ```bash
   npx prisma studio
   ```

2. **Test Google Drive:**
   ```bash
   dotenv -e .env -- npx ts-node src/scripts/test-google-drive-csv.ts
   ```

3. **Test Redis:**
   ```bash
   redis-cli -u "$REDIS_URL" ping
   # Should return: PONG
   ```

4. **Test Telegram (if configured):**
   ```bash
   dotenv -e .env -- npx ts-node src/scripts/test-telegram.ts
   ```

5. **Test Chrome connection:**
   ```bash
   # Ensure Chrome is running with remote debugging
   curl http://127.0.0.1:19203/json/version
   # Should return Chrome version info
   ```

## Troubleshooting

### "invalid_client" Error

- Ensure redirect URI in `.env` matches Google Cloud Console exactly
- Check for extra spaces in Client ID/Secret
- Verify you're using "Web application" client type

### Refresh Token Expired

- Run the authorization script again:
  ```bash
  dotenv -e .env -- npx ts-node src/scripts/get-google-oauth-tokens.ts
  ```

### Cannot Connect to Redis

- Verify the database is reachable: `redis-cli -u "$REDIS_URL" ping`
- Check `REDIS_URL` in `.env` (or `REDIS_HOST`/`REDIS_PORT` if using discrete vars)
- Confirm the Redis Cloud database's allowlist permits your server's IP
- If the database has TLS enabled, make sure the URL uses `rediss://` (or set `REDIS_TLS=true` with discrete vars)

### Files Not Found

- Verify folder IDs are correct
- Check file naming convention: `adesa-MM-DD-YYYY.csv` or `edge-MM-DD-YYYY.csv`
- Ensure files are in the correct folders
- Check Google Drive API permissions

### Chrome Connection Failed

- Ensure Chrome is running with `--remote-debugging-port=19203`
- Verify Chrome is listening: `curl http://127.0.0.1:19203/json/version`
- Check if port 19203 is already in use
- Ensure Chrome profile path is correct
- Verify Proxy Omega 3 extension is installed and configured
- Check proxy forwarding settings for `dealercenter.net`

