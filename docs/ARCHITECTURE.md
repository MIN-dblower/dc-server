# Architecture Overview

High-level architecture of the Scrape Engine system.

## System Components

```mermaid
graph TB
    GD[Google Drive<br/>Auction Files] -->|Monitors| AM[Auction Monitor<br/>Producer]
    AM -->|Enqueues Jobs| BQ[BullMQ Job Queue<br/>Redis]
    AM -->|Saves Directly| DB[(PostgreSQL<br/>Database)]
    BQ -->|Processes Jobs| DC[DC Sync Worker<br/>Consumer]
    DC -->|Updates via| CH[Chrome Browser<br/>Remote Debugging<br/>Port 19203]
    CH -->|Interacts with| DCS[Dealer Center<br/>Puppeteer]
    DC -->|Saves Results| DB
    DC -->|Sends Alerts| TG[Telegram Bot<br/>Alerts]
    DB -->|Alerts| TG

    style GD fill:#e1f5ff
    style AM fill:#fff4e1
    style BQ fill:#ffe1e1
    style DC fill:#e1ffe1
    style DB fill:#f0f0ff
    style CH fill:#ffe6f0
    style DCS fill:#e6ffe6
    style TG fill:#fff9e1
```

## Worker Architecture

### Producer: Auction Monitor

**Responsibilities:**
- Monitor Google Drive folders on schedule
- Detect auction files (CSV/Sheets)
- Parse vehicle data
- Detect changes (new vs. existing VINs)
- Enqueue DC update jobs
- Save DB-only records directly

**Flow:**

```mermaid
flowchart LR
    A[Check Active<br/>Monitoring Windows] --> B[Scan Drive<br/>Folders]
    B --> C[Download &<br/>Parse Files]
    C --> D[Compare with<br/>Database Records]
    D --> E{Record<br/>Type?}
    E -->|New/Changed| F[Enqueue DC<br/>Update Job]
    E -->|No Changes| G[Save to DB<br/>Directly]
    F --> H[Job Queue]
    G --> DB[(Database)]

    style A fill:#e1f5ff
    style F fill:#fff4e1
    style H fill:#ffe1e1
    style G fill:#e1ffe1
    style DB fill:#f0f0ff
```

### Consumer: DC Sync Worker

**Responsibilities:**
- Process jobs from BullMQ queue
- Update Dealer Center via Puppeteer
- Save results to database
- Handle retries and failures
- Send alerts on errors

**Flow:**

```mermaid
flowchart TD
    A[Connect to Redis<br/>Queue] --> B[Process Job<br/>Sequentially]
    B --> C[Extract VIN &<br/>Vehicle Data]
    C --> D[Connect to Chrome<br/>via Puppeteer<br/>Port 19203]
    D --> E[Navigate Dealer<br/>Center]
    E --> F{Update<br/>Success?}
    F -->|Yes| G[Save Results<br/>to Database]
    F -->|No| H{Retry<br/>Count < 3?}
    H -->|Yes| I[Wait Exponential<br/>Backoff]
    I --> B
    H -->|No| J[Move to Failed<br/>Queue]
    J --> K[Send Telegram<br/>Alert]
    G --> L[Mark Job<br/>Complete]

    style A fill:#e1f5ff
    style D fill:#ffe6f0
    style E fill:#e6ffe6
    style G fill:#e1ffe1
    style J fill:#ffe1e1
    style K fill:#fff9e1
```

**Why Sequential Processing?**
- Puppeteer browser instances conflict when run in parallel
- Dealer Center may throttle concurrent requests
- Sequential processing ensures stability and reliability

### Job Queue System

**Technology:** BullMQ with Redis

**Queue:** `dc-update-queue`

**Job Types:**
- `DC_UPDATE_JOB`: Vehicle record needing Dealer Center sync

**Job Data:**
```typescript
{
  record: AdesaRecord | EdgePipelineRecord,
  isNewRecord: boolean,
  auctionType: 'Adesa' | 'Edge Pipeline',
  fileId: string,
  fileName: string,
  timestamp: Date
}
```

**Job Configuration:**
- **Concurrency:** 1 (sequential processing)
- **Attempts:** 3 retries
- **Backoff:** Exponential (1s, 2s, 4s)
- **Timeout:** 5 minutes per job
- **Deduplication:** By VIN (prevents duplicate processing)

## Data Flow

```mermaid
flowchart TD
    AF[Auction File] -->|Parse| MON[Auction Monitor]
    
    MON -->|New VIN| NV[New Vehicle]
    MON -->|Existing VIN<br/>Changed| EV[Existing Vehicle<br/>Changed]
    MON -->|Existing VIN<br/>No Changes| SK[Skip Record]
    
    NV -->|Import All Data| NV1[(Save to DB)]
    NV1 -->|Enqueue Job| NV2[DC Sync Worker]
    NV2 -->|Create Appraisal| NV3[Dealer Center]
    NV3 -->|Save Results| NV4[(Database)]
    
    EV -->|Append Changed<br/>Records Only| EV1[(Save to DB)]
    EV1 -->|If Odometer/<br/>Notes Changed| EV2[DC Sync Worker]
    EV2 -->|Update Appraisal| EV3[Dealer Center]
    EV3 -->|Save Results| EV4[(Database)]
    
    SK -->|No Processing| END[End]

    style NV fill:#e1ffe1
    style EV fill:#fff4e1
    style SK fill:#f0f0f0
    style NV3 fill:#e6ffe6
    style EV3 fill:#e6ffe6
```

## Monitoring Schedules

### Adesa Auction
- **Day:** Wednesday
- **Monitor Start:** Friday before auction
- **Monitor End:** Wednesday 12 PM
- **File Pattern:** `adesa-MM-DD-YYYY.csv`

### Edge Auction
- **Day:** Thursday
- **Monitor Start:** Monday of auction week
- **Monitor End:** Thursday (end of day)
- **File Pattern:** `edge-MM-DD-YYYY.csv`

## Error Handling

### Blocked VINs
When a VIN encounters an uncovered case:
1. VIN automatically blocked in Redis
2. Telegram alert sent with details
3. Future processing skipped
4. Manual unblock after fix

### Job Failures
- Automatic retry: 3 attempts with exponential backoff
- On final failure: Move to failed queue, send Telegram alert
- Manual retry available via dashboard

### System Failures
- **Producer crash:** Jobs remain in Redis, consumer continues
- **Consumer crash:** Jobs remain in queue, resume on restart
- **Redis connection lost:** Automatic reconnection with retry
- **Database connection lost:** Automatic reconnection with retry

## Technology Stack

- **Runtime:** Node.js 18+ with TypeScript
- **Database:** PostgreSQL with Prisma ORM
- **Job Queue:** BullMQ with Redis
- **Automation:** Puppeteer for Dealer Center interaction
- **Cloud Storage:** Google Drive API
- **Notifications:** Telegram Bot API
- **Process Manager:** PM2 (production)

## Scalability

**Current Limits:**
- 1 DC sync worker (sequential processing required)
- Multiple auction monitors can run (one per auction type)

**Future Enhancements:**
- Priority queues for urgent updates
- Batch processing for multiple records
- Rate limiting for DC updates
- Multi-tenant support with separate queues

