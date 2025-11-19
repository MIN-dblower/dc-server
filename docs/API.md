# API Documentation

Internal API endpoints used by the system for Dealer Center integration.

## VIN Duplicate Check

Check if a vehicle with the given VIN already exists in Dealer Center.

**Endpoint:** `POST https://app.dealercenter.net/api-gateway/inventory/Inventory/CheckVinDuplicate`

**Request:**
```json
{
  "vin": "1G1FE1R70K0156326",
  "companyId": null
}
```

**Response:**
```json
{
  "inventoryId": "924abd80-3808-4510-b8a4-08dd2fac24c2",
  "inventoryStatusId": 0,
  "companyId": "55b0c719-88fc-4575-8ff9-bfabc0114321",
  "companyName": "Springer Automotive Group Inc",
  "vin": "1G1FE1R70K0156326"
}
```

**Usage:**
- Returns inventory information if VIN exists
- Returns null/error if VIN not found
- Used to determine if vehicle needs new appraisal or update

## Load Inventory by ID

Load detailed inventory data for an existing vehicle.

**Endpoint:** `POST https://app.dealercenter.net/api-gateway/inventory/Inventory/LoadInventoryById`

**Request:**
```json
{
  "inventoryId": "924abd80-3808-4510-b8a4-08dd2fac24c2",
  "loadOption": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 16, 11],
  "setIsCurrentForBook": false
}
```

**Response:**
Returns detailed vehicle build data including:
- Vehicle information
- Appraisal history
- Pricing data
- Equipment and options
- Market comparisons

**Usage:**
- Load existing vehicle data for updates
- Obtain build history for comparison
- Retrieve previous appraisal information

## Get Vehicle Pool (Similar Vehicles)

Get similar vehicles for market comparison.

**Endpoint:** `POST https://app.dealercenter.net/api-gateway/inventory/Inventory/GetVehiclePool`

**Request:**
```json
{
  "vehicleInfo": {
    "entityID": "00000000-0000-0000-0000-000000000000",
    "entityTypeID": 3,
    "vin": "WMWLV7C00L2L81812",
    "stockNumber": "",
    "year": 2020,
    "make": "MINI",
    "model": "Clubman",
    "trim": "Cooper S",
    "odometer": 30340,
    "body": "Hatchback",
    "color": null,
    "engine": "4-Cyl, Turbo, 2.0 Liter",
    "transmission": "Automatic, 7-Spd w/Steptronic",
    "driveTrain": "FWD",
    "fuelType": "Gasoline",
    "modelId": "448251",
    "vehiclePrice": 0,
    "advertisingPrice": 0,
    "askingPrice": 0,
    "specialPrice": 0,
    "specialPriceStartDate": null,
    "specialPriceEndDate": null,
    "price": 0,
    "totalCost": 0,
    "certified": null,
    "equipment": [...],
    "equipmentIds": [...]
  },
  "filters": {
    "bodyStyles": [],
    "driveTrains": [],
    "engines": [],
    "equipments": [],
    "fuelTypes": [],
    "geoCoordinate": null,
    "isActive": 1,
    "isCertified": null,
    "longitude": 0,
    "latitude": 0,
    "modelAggregate": ["Clubman"],
    "odometerMax": 45340,
    "odometerMin": 15340,
    "packages": [],
    "radiusInMiles": 500,
    "transmissions": [],
    "trims": ["Cooper S"],
    "yearAdjusment": 0,
    "years": [2020],
    "zip": "62298"
  },
  "maxDigitalPriceLockType": null
}
```

**Usage:**
- Find similar vehicles for market comparison
- Calculate market average price
- Set competitive pricing based on comparable vehicles

