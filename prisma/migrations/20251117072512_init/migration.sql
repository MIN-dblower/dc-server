-- CreateTable
CREATE TABLE "EdgePipelineRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auctionName" TEXT NOT NULL,
    "pictureCount" INTEGER NOT NULL,
    "runNumber" TEXT NOT NULL,
    "stockNumber" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "odometer" INTEGER NOT NULL,
    "cr" TEXT NOT NULL,
    "grade" REAL NOT NULL,
    "saleDate" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "soldAmount" TEXT NOT NULL,
    "watchNotes" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AdesaAuctionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "laneRun" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "saleChannel" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "transmission" TEXT NOT NULL,
    "drivetrain" TEXT NOT NULL,
    "fuel" TEXT NOT NULL,
    "exteriorColor" TEXT NOT NULL,
    "odometer" INTEGER NOT NULL,
    "grade" REAL NOT NULL,
    "conditionGuarantee" TEXT NOT NULL,
    "driveability" TEXT NOT NULL,
    "carValue" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "announcements" TEXT NOT NULL,
    "titleStatus" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "EdgePipelineRecord_vin_key" ON "EdgePipelineRecord"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "AdesaAuctionRecord_vin_key" ON "AdesaAuctionRecord"("vin");
