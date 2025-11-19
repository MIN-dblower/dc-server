# Dealer Center Update Process

## Process Steps

1. Get VIN
2. Get odometer
3. Set parameters/trim
4. Post notes
5. Open market data
6. Set market comps
7. Set retail and lock
8. Add lot fee
9. Add recon
10. Calculate auction fee
11. Lock profit
12. Save

## Flow

### 1. VIN Check
- Check if vehicle with VIN is already registered on Dealer Center
- **If registered:** Get inventory ID and proceed with update
- **If not registered:** Proceed with new vehicle creation

### 2. Market Pricing
- Check market average price (e.g., 34000 → 33998)
- Lock pricing
- Set margin based on asking price (reference: Excel Sheet)

### 3. Fees

**Lot Fee:**
- Always $500

**Auction Fee:**
- Appraisal value → Adesa fee list
- Extra $50 for Adesa auctions

**Reconditioning:**
- Base: $110 (inspection)
- Mileage-based recon:
  - 0 - 25,000 miles: $175
  - 25,001 - 50,000 miles: $275
  - 50,001 - 75,000 miles: $375
  - 75,000+ miles: $500
- Detail cleaning: $125

**Total Reconditioning = Base ($110) + Mileage-Based + Detail Cleaning ($125)**


