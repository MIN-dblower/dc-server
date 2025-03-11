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
