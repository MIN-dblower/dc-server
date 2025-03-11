import { Page } from 'puppeteer';
import { sendAPIRequest, Window } from '../class/window';
import { delay } from '../lib/time';
import * as cheerio from 'cheerio';
import { IAnswer, IQuestion } from '../interfaces/dealercenter.types';
import { UserAnswer } from '../interfaces/dealercenter.validation';

enum Status {
  NOT_AUTHORIZED = 'not_authorized',
  DUPLICATE_VIN = 'duplicate_vin',
  COMPLETE_PROCESS = 'complete_process',
}
export class DataCenterScraper {
  window: Window;
  screenshotDir: string;
  constructor() {

    this.window = new Window(true);
    this.screenshotDir = 'screenshots/datacenter/';
  }
  async openScraper() {
    const page = await this.window.connectRemote(19203);
    return page;
  }
  async login(page: Page) {
    const url = await page.url();
    if (url.includes('app.dealercenter.net')) return;
    await page.goto('https://dmsapp.dealercenter.net/home/postsignin');
    await page.waitForSelector('#login');
    await Promise.all([page.click('#login'), page.waitForNavigation()]);
  }
  async checkModal(page: Page) {
    const titleText = await page.evaluate(() => {
      const div = document.querySelector(
        'kendo-dialog kendo-dialog-titlebar span',
      );
      return div ? div.textContent?.trim() : null;
    });
    if (titleText === 'Login') return Status.NOT_AUTHORIZED;
  }
  async gotoAppraisalPage(page: Page) {
    await page.goto(
      `https://app.dealercenter.net/apps/shell/inventory/vehicle/new/appraisal`,
    );
    await page.waitForNavigation({
      timeout: 2000,
    });
  }
  async getData(page: Page, vin: string, data: { odometer?: number; prompts?: UserAnswer }) {
    await this.gotoAppraisalPage(page);
    await delay(1000);
    const result: { [key: string]: any } = {};
    const status = await this.checkModal(page);
    if (status === Status.NOT_AUTHORIZED) {
      await this.login(page);
      await this.gotoAppraisalPage(page);
    }

    const tokens = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/admin/userauth/public/validaterefreshtoken',
      'GET',
      {},
    );
    console.log(tokens);

    // Check VIN Duplicates
    const duplicateData = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/CheckVinDuplicate',
      'POST',
      {
        Authorization: `Bearer ${tokens.userAccessToken}`,
      },
      {
        vin: vin,
        companyId: null,
      },
    );
    if (duplicateData.inventoryId) {
      console.log('Already appraised vehicle');
      const bookData = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/Inventory/LoadInventoryById',
        'POST',
        {
          Authorization: `Bearer ${tokens.userAccessToken}`,
        },
        {
          inventoryId: duplicateData.inventoryId,
          loadOption: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 16, 11],
          setIsCurrentForBook: false,
        },
      );
      const kbbValue = bookData.vehicleBuilds.find(
        (el: any) => el.bookServiceTypeId === 1,
      );
      const nadaValue = bookData.vehicleBuilds.find(
        (el: any) => el.bookServiceTypeId === 2,
      );
      const blackBookValue = bookData.vehicleBuilds.find(
        (el: any) => el.bookServiceTypeId === 3,
      );
      const manheimBuild = bookData.vehicleBuilds.find(
        (el: any) => el.bookServiceTypeId === 4,
      );
      const vehicleMeta = {
        make: kbbValue.make,
        trim: kbbValue.trim,
        year: kbbValue.year,
        body: kbbValue.bodyType,
        driveTrain: kbbValue.driveTrain,
        fuelType: kbbValue.fuelType,
        modelId: kbbValue.modelIdentifier,
        model: kbbValue.model,
        transmission: kbbValue.transmission,
        engine: kbbValue.engine,
        trimName: kbbValue.trimName,
        equipmentCodes: kbbValue.vehicleEquipments
          .filter((el: any) => el.checked)
          .map((el: any) => el.codeDescription),
        equipmentIds: kbbValue.vehicleEquipments
          .filter((el: any) => el.checked)
          .map((el: any) => el.code),
        stockNumber: bookData.stockNumber,
      };

      const odometer = bookData.odometer ?? data.odometer;


      const manheimValue = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          method: 1,
          odometer,
          vehicleType: 1,
          vin: vin,
          isTitleBrandCommercial: false,
          hasExistingNadaBooked: false,
          hasExistingBBBooked: false,
          year: vehicleMeta.year,
          make: vehicleMeta.make,
          modelName: vehicleMeta.model,
          trim: vehicleMeta.trim,
          vehicleBuilds: [
            {
              region: 'NA',
              color: 'Black',
              grade: 43,
              bookType: 4,
              vehicleBuildDTO: manheimBuild,
            },
          ],
        },
      );

      console.log('Kelley:', {
        tradeInGood: kbbValue.kelley.tradeInGood,
        retailBook: kbbValue.kelley.retailBook,
      });

      console.log('NADA(JD POWER):', {
        tradeAvgBook: nadaValue.nada.tradeAvgBook,
        retailBook: nadaValue.nada.retailBook,
      });
      console.log('Black Book Value: ', {
        retail: blackBookValue.blackBook.totalRetailClean,
        trade:
          blackBookValue.blackBook.baseTradeInAvg -
          blackBookValue.blackBook.packageTradeInAvg,
      });
      console.log(
        'Manheim Value:',
        manheimValue.manheim.adjustedWholesaleAverage,
      );

      result['book'] = {
        kelley: {
          tradeInGood: kbbValue.kelley.tradeInGood,
          retailBook: kbbValue.kelley.retailBook,
        },
        jdpower: {
          tradeAvgBook: nadaValue.nada.tradeAvgBook,
          retailBook: nadaValue.nada.retailBook,
        },
        blackbook: {
          retail: blackBookValue.blackBook.totalRetailClean,
          trade:
            blackBookValue.blackBook.baseTradeInAvg -
            blackBookValue.blackBook.packageTradeInAvg,
        },
        manheim: manheimValue.manheim.adjustedWholesaleAverage
      }

      console.log('NOW GETTING VEHICLE POOLS');
      const buildMatchingData = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/MarketDataBuildMatching',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          marketingCompleteMatching: false,
          modelDefinition: {
            book: 1,
            equipment: vehicleMeta.equipmentCodes,
            modelId: vehicleMeta.modelId,
            vehicleInformation: {
              entityID: duplicateData.inventoryId,
              entityTypeID: 3,
              vin: vin,
              stockNumber: vehicleMeta.stockNumber,
              year: vehicleMeta.year,
              make: vehicleMeta.make,
              model: vehicleMeta.model,
              trim: vehicleMeta.trim,
              odometer: 30340,
              body: vehicleMeta.body,
              color: null,
              engine: vehicleMeta.engine,
              transmission: vehicleMeta.transmission,
              driveTrain: vehicleMeta.driveTrain,
              fuelType: vehicleMeta.fuelType,
              modelId: vehicleMeta.modelId,
              vehiclePrice: 0,
              advertisingPrice: 0,
              askingPrice: 0,
              specialPrice: 0,
              specialPriceStartDate: null,
              specialPriceEndDate: null,
              price: 0,
              totalCost: 0,
              certified: null,
              equipment: vehicleMeta.equipmentCodes,
              equipmentIds: vehicleMeta.equipmentIds,
            },
          },
        },
      );
      console.log(buildMatchingData);
      const filters = {
        bodyStyles: [],
        driveTrains: [],
        engines: [],
        equipments: [],
        fuelTypes: [],
        geoCoordinate: null,
        isActive: 1,
        isCertified: null,
        longitude: 0,
        latitude: 0,
        modelAggregate: [vehicleMeta.model],
        odometerMax: odometer + 15000,
        odometerMin: odometer - 15000,
        packages: [],
        radiusInMiles: 500,
        transmissions: [],
        trims: buildMatchingData.optionCollection.trims.map(
          (el: any) => el.name,
        ),
        yearAdjusment: 0,

        years: [vehicleMeta.year],
        zip: '62298',
      };
      const marketLookupData = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetFilterLookupData',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo: {
            entityID: duplicateData.inventoryId,
            entityTypeID: 3,
            vin: vin,
            stockNumber: vehicleMeta.stockNumber,
            year: vehicleMeta.year,
            make: vehicleMeta.make,
            model: vehicleMeta.model,
            trim: vehicleMeta.trim,
            odometer: 30340,
            body: vehicleMeta.body,
            color: null,
            engine: vehicleMeta.engine,
            transmission: vehicleMeta.transmission,
            driveTrain: vehicleMeta.driveTrain,
            fuelType: vehicleMeta.fuelType,
            modelId: vehicleMeta.modelId,
            vehiclePrice: 0,
            advertisingPrice: 0,
            askingPrice: 0,
            specialPrice: 0,
            specialPriceStartDate: null,
            specialPriceEndDate: null,
            price: 0,
            totalCost: 0,
            certified: null,
            equipment: vehicleMeta.equipmentCodes,
            equipmentIds: vehicleMeta.equipmentIds,
          },
        },
      );
      console.log(marketLookupData);
      const marketLookupStats = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=0',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo: {
            entityID: duplicateData.inventoryId,
            entityTypeID: 3,
            vin: vin,
            stockNumber: vehicleMeta.stockNumber,
            year: vehicleMeta.year,
            make: vehicleMeta.make,
            model: vehicleMeta.model,
            trim: vehicleMeta.trim,
            odometer: 30340,
            body: vehicleMeta.body,
            color: null,
            engine: vehicleMeta.engine,
            transmission: vehicleMeta.transmission,
            driveTrain: vehicleMeta.driveTrain,
            fuelType: vehicleMeta.fuelType,
            modelId: vehicleMeta.modelId,
            vehiclePrice: 0,
            advertisingPrice: 0,
            askingPrice: 0,
            specialPrice: 0,
            specialPriceStartDate: null,
            specialPriceEndDate: null,
            price: 0,
            totalCost: 0,
            certified: null,
            equipment: vehicleMeta.equipmentCodes,
            equipmentIds: vehicleMeta.equipmentIds,
          },
        },
      );
      console.log(marketLookupStats);

      const priceRankingData = await sendAPIRequest(
        page,
        `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetPriceRankings?matching=${marketLookupStats.vehicleCount}`,
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo: {
            entityID: duplicateData.inventoryId,
            entityTypeID: 3,
            vin: vin,
            stockNumber: vehicleMeta.stockNumber,
            year: vehicleMeta.year,
            make: vehicleMeta.make,
            model: vehicleMeta.model,
            trim: vehicleMeta.trim,
            odometer: 30340,
            body: vehicleMeta.body,
            color: null,
            engine: vehicleMeta.engine,
            transmission: vehicleMeta.transmission,
            driveTrain: vehicleMeta.driveTrain,
            fuelType: vehicleMeta.fuelType,
            modelId: vehicleMeta.modelId,
            vehiclePrice: 0,
            advertisingPrice: 0,
            askingPrice: 0,
            specialPrice: 0,
            specialPriceStartDate: null,
            specialPriceEndDate: null,
            price: 0,
            totalCost: 0,
            certified: null,
            equipment: vehicleMeta.equipmentCodes,
            equipmentIds: vehicleMeta.equipmentIds,
          },
        },
      );
      console.log(priceRankingData);
      const marketSupplyData = await sendAPIRequest(
        page,
        `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketListDaysSupply`,
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          filters,
          maxDigitalPriceLockType: null,
          currentVehicle: {
            entityID: duplicateData.inventoryId,
            entityTypeID: 3,
            vin: vin,
            stockNumber: vehicleMeta.stockNumber,
            year: vehicleMeta.year,
            make: vehicleMeta.make,
            model: vehicleMeta.model,
            trim: vehicleMeta.trim,
            odometer: 30340,
            body: vehicleMeta.body,
            color: null,
            engine: vehicleMeta.engine,
            transmission: vehicleMeta.transmission,
            driveTrain: vehicleMeta.driveTrain,
            fuelType: vehicleMeta.fuelType,
            modelId: vehicleMeta.modelId,
            vehiclePrice: 0,
            advertisingPrice: 0,
            askingPrice: 0,
            specialPrice: 0,
            specialPriceStartDate: null,
            specialPriceEndDate: null,
            price: 0,
            totalCost: 0,
            certified: null,
            equipment: vehicleMeta.equipmentCodes,
            equipmentIds: vehicleMeta.equipmentIds,
          },
          marketAnalyticsRequestSort: {
            field: 'advertisement.price',
            order: 'ASC',
          },
          pageNumber: 1,
          pageSize: marketLookupStats.vehicleCount,
          saveMarketPricingResponse: false,
          ranks: priceRankingData,
          alreadyComputedPageNumber: false,
        },
      );
      // console.log(marketSupplyData);
    } else {
      if (!data.odometer) {
        return {
          questions: [{
            message: "odometer is required"
          }]
        }
      }

      const { question, vehicleBuilds } = await this.getBuild(
        page,
        vin,
        tokens.userAccessToken,
        (data.prompts || []).map(el => ({
          book: el.book,
          isBlank: null,
          addDeduct: el.type === 'checkbox' ? el.items.map(il => ({
            code: il.id,
            action: il.isChecked ? 0 : 1,
          })) : [],
          modelId: el.type === 'select' ? el.id : undefined,
        })),
      );
      if (question) return { question };
      const vehicleMeta = {
        make: vehicleBuilds[0].make,
        trim: vehicleBuilds[0].trim,
        year: vehicleBuilds[0].year,
        body: vehicleBuilds[0].bodyType,
        driveTrain: vehicleBuilds[0].driveTrain,
        fuelType: vehicleBuilds[0].fuelType,
        modelId: vehicleBuilds[0].modelIdentifier,
        model: vehicleBuilds[0].model,
        transmission: vehicleBuilds[0].transmission,
        engine: vehicleBuilds[0].engine,
        trimName: vehicleBuilds[0].trimName,
        equipmentCodes: vehicleBuilds[0].vehicleEquipments
          .filter((el: any) => el.checked)
          .map((el: any) => el.codeDescription),
        equipmentIds: vehicleBuilds[0].vehicleEquipments
          .filter((el: any) => el.checked)
          .map((el: any) => el.code),
      };
      const kbbBuild = vehicleBuilds.find(
        (el: any) => el.bookServiceTypeId === 1,
      );
      // console.log(kbbBuild);

      const valueData = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          method: 1,
          odometer: data.odometer,
          vehicleType: 1,
          vin: vin,
          isTitleBrandCommercial: false,
          hasExistingNadaBooked: false,
          hasExistingBBBooked: false,
          year: vehicleMeta.year,
          make: vehicleMeta.make,
          modelName: vehicleMeta.model,
          trim: vehicleMeta.trim,
          vehicleBuilds: [
            {
              region: '92683',
              bookPeriod: null,
              equipmentIds: kbbBuild.vehicleEquipments
                .filter((el: any) => el.checked)
                .map((el: any) => el.code),
              bookType: 1,
              modelId: kbbBuild.modelIdentifier,
              vehicleBuildDTO: kbbBuild,
            },
          ],
        },
      );
      console.log('Kelley:', {
        tradeInGood: valueData.kelley.tradeInGood,
        retailBook: valueData.kelley.retailBook,
      });

      const nadaBuild = vehicleBuilds.find(
        (el: any) => el.bookServiceTypeId === 2,
      );
      const nadaValue = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          method: 1,
          odometer: data.odometer,
          vehicleType: 1,
          vin: vin,
          isTitleBrandCommercial: false,
          hasExistingNadaBooked: false,
          hasExistingBBBooked: false,
          year: vehicleMeta.year,
          make: vehicleMeta.make,
          modelName: vehicleMeta.model,
          trim: vehicleMeta.trim,
          vehicleBuilds: [
            {
              region: 'IA',
              modelId: nadaBuild.modelIdentifier,
              bookType: 2,
              bookPeriod: null,
              equipmentIds: nadaBuild.vehicleEquipments
                .filter((el: any) => el.checked)
                .map((el: any) => el.code),
              vehicleBuildDTO: nadaBuild,
            },
          ],
        },
      );
      console.log('NADA(JD POWER):', {
        tradeAvgBook: nadaValue.nada?.tradeAvgBook,
        retailBook: nadaValue.nada?.retailBook,
      });
      const blackBookBuild = vehicleBuilds.find(
        (el: any) => el.bookServiceTypeId === 3,
      );
      const blackBookValue = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          method: 1,
          odometer: data.odometer,
          vehicleType: 1,
          vin: vin,
          isTitleBrandCommercial: false,
          hasExistingNadaBooked: false,
          hasExistingBBBooked: false,
          year: vehicleMeta.year,
          make: vehicleMeta.make,
          modelName: vehicleMeta.model,
          trim: vehicleMeta.trim,
          vehicleBuilds: [
            {
              region: 'IL',
              modelId: blackBookBuild.modelIdentifier,
              bookType: 3,
              bookPeriod: null,
              equipmentIds: blackBookBuild.vehicleEquipments
                .filter((el: any) => el.checked)
                .map((el: any) => el.code),
              vehicleBuildDTO: blackBookBuild,
            },
          ],
        },
      );
      console.log('Black Book Value: ', {
        retail: blackBookValue.blackBook?.totalRetailClean,
        trade:
          blackBookValue.blackBook?.baseTradeInAvg -
          blackBookValue.blackBook?.packageTradeInAvg,
      });
      const manheimBuild = vehicleBuilds.find(
        (el: any) => el.bookServiceTypeId === 4,
      );
      const manheimValue = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          method: 1,
          odometer: data.odometer,
          vehicleType: 1,
          vin: vin,
          isTitleBrandCommercial: false,
          hasExistingNadaBooked: false,
          hasExistingBBBooked: false,
          year: vehicleMeta.year,
          make: vehicleMeta.make,
          modelName: vehicleMeta.model,
          trim: vehicleMeta.trim,
          vehicleBuilds: [
            {
              region: 'NA',
              color: 'Black',
              grade: 43,
              bookType: 4,
              vehicleBuildDTO: manheimBuild,
            },
          ],
        },
      );
      console.log(
        'Manheim Value:',
        manheimValue.manheim?.adjustedWholesaleAverage,
      );
      result['book'] = {
        kelley: {
          tradeInGood: valueData.kelley.tradeInGood,
          retailBook: valueData.kelley.retailBook,
        },
        jdpower: {
          tradeAvgBook: nadaValue.nada.tradeAvgBook,
          retailBook: nadaValue.nada.retailBook,
        },
        blackbook: {
          retail: blackBookValue.blackBook.totalRetailClean,
          trade:
            blackBookValue.blackBook.baseTradeInAvg -
            blackBookValue.blackBook.packageTradeInAvg,
        },
        manheim: manheimValue.manheim.adjustedWholesaleAverage
      }

      console.log('NOW GETTING VEHICLE POOLS');
      // console.log(vehicleMeta);
      const buildMatchingData = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/MarketDataBuildMatching',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          marketingCompleteMatching: false,
          modelDefinition: {
            book: 1,
            equipment: vehicleMeta.equipmentCodes,
            modelId: vehicleMeta.modelId,
            vehicleInformation: {
              entityID: '00000000-0000-0000-0000-000000000000',
              entityTypeID: 3,
              vin: vin,
              stockNumber: '',
              year: vehicleMeta.year,
              make: vehicleMeta.make,
              model: vehicleMeta.model,
              trim: vehicleMeta.trim,
              odometer: data.odometer,
              body: vehicleMeta.body,
              color: null,
              engine: vehicleMeta.engine,
              transmission: vehicleMeta.transmission,
              driveTrain: vehicleMeta.driveTrain,
              fuelType: vehicleMeta.fuelType,
              modelId: vehicleMeta.modelId,
              vehiclePrice: 0,
              advertisingPrice: 0,
              askingPrice: 0,
              specialPrice: 0,
              specialPriceStartDate: null,
              specialPriceEndDate: null,
              price: 0,
              totalCost: 0,
              certified: null,
              equipment: vehicleMeta.equipmentCodes,
              equipmentIds: vehicleMeta.equipmentIds,
            },
          },
        },
      );
      const locationPreset = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 5000];
      let locationIndex = 4;
      const filters = {
        bodyStyles: [],
        driveTrains: [],
        engines: [],
        equipments: [],
        fuelTypes: [],
        geoCoordinate: null,
        isActive: 1,
        isCertified: null,
        longitude: 0,
        latitude: 0,
        modelAggregate: buildMatchingData.optionCollection.models.map(
          (el: any) => el.name,
        ),
        odometerMax: data.odometer + 15000,
        odometerMin: data.odometer - 15000,
        packages: [],
        radiusInMiles: 0,
        transmissions: [],
        trims: buildMatchingData.optionCollection.trims.map(
          (el: any) => el.name,
        ),
        yearAdjusment: 0,
        years: [vehicleMeta.year],
        zip: '62298',
      };
      const vehicleInfo = {
        entityID: '00000000-0000-0000-0000-000000000000',
        entityTypeID: 3,
        vin: vin,
        stockNumber: '',
        year: vehicleMeta.year,
        make: vehicleMeta.make,
        model: filters.modelAggregate.length
          ? filters.modelAggregate[0]
          : vehicleMeta.model,
        trim: filters.trims.length ? filters.trims[0] : vehicleMeta.trim,
        odometer: data.odometer,
        body: vehicleMeta.body,
        color: null,
        engine: vehicleMeta.engine,
        transmission: vehicleMeta.transmission,
        driveTrain: vehicleMeta.driveTrain,
        fuelType: vehicleMeta.fuelType,
        modelId: vehicleMeta.modelId,
        vehiclePrice: 0,
        advertisingPrice: 0,
        askingPrice: 0,
        specialPrice: 0,
        specialPriceStartDate: null,
        specialPriceEndDate: null,
        price: 0,
        totalCost: 0,
        certified: null,
        equipment: vehicleMeta.equipmentCodes,
        equipmentIds: vehicleMeta.equipmentIds,
      };

      console.log(filters);
      let previousCount = -1;
      do {
        filters.radiusInMiles = locationPreset[locationIndex];
        console.log('Milage: ', locationPreset[locationIndex])
        const marketLookupData = await sendAPIRequest(
          page,
          'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetFilterLookupData',
          'POST',
          { Authorization: `Bearer ${tokens.userAccessToken}` },
          {
            filters,
            maxDigitalPriceLockType: null,
            vehicleInfo,
          },
        );
        const count = marketLookupData.listings.reduce((sum: number, item: any) => sum + item.count, 0);
        console.log('Result: ', count)
        if (previousCount === -1) previousCount = count;
        if (count >= 10 && count < 20) {
          // this is an ideal case.
          break;
        }
        if (previousCount > 20 && count < 10) {
          locationIndex += 1;
          filters.radiusInMiles = locationPreset[locationIndex];
          break;
        }
        if (previousCount < 9 && count > 20) {
          locationIndex -= 1;
          filters.radiusInMiles = locationPreset[locationIndex];
          break;
        }
        if (previousCount < 10 && count < 10) {
          if (locationIndex < locationPreset.length - 1) locationIndex += 1;
          else break;
        };
        if (previousCount > 20 && count > 20) {
          if (locationIndex > 0) locationIndex -= 1;
          else break;
        }
        previousCount = count;

      } while (true);
      const marketLookupStats = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=0',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo,
        },
      );
      console.log(marketLookupStats);

      const priceRankingData = await sendAPIRequest(
        page,
        `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetPriceRankings?matching=${marketLookupStats.vehicleCount}`,
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo,
        },
      );
      console.log(priceRankingData.length);
      const marketSupplyData = await sendAPIRequest(
        page,
        `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketListDaysSupply`,
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          filters,
          maxDigitalPriceLockType: null,
          currentVehicle: vehicleInfo,
          marketAnalyticsRequestSort: {
            field: 'advertisement.price',
            order: 'ASC',
          },
          pageNumber: 1,
          pageSize: marketLookupStats.vehicleCount,
          saveMarketPricingResponse: false,
          ranks: priceRankingData,
          alreadyComputedPageNumber: false,
        },
      );
      result['comp'] = marketSupplyData.items || [];
      // console.log(marketSupplyData);
    }
    return result;
  }

  async getBuild(
    page: Page,
    vin: string,
    token: string,
    answers: Array<IAnswer>,
  ): Promise<{ question: any, vehicleBuilds: any }> {
    const { question, vehicleBuilds } = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetVehicleBuilds',
      'POST',
      { Authorization: `Bearer ${token}` },
      {
        method: 2,
        requestedBook: [1, 2, 3, 4],
        defaultBookServiceType: 1,
        input: {
          vin: vin,
          year: null,
          make: null,
          modelName: null,
          trim: null,
          book: 1,
          additionalModelInfos: [],
          answers,
        },
      },
    );
    const questionObj: IQuestion | undefined = (question && question.options.length > 0) ? {
      book: question.book,
      category: question.options[0].subTitle,
      items: question.options[0].items.map((el: any) => ({
        id: el.id,
        name: el.displayName,
      })),
      type: question.options[0].optionType === 1 ? 'checkbox' : 'select',
    } : undefined;
    return { question: questionObj, vehicleBuilds }

    if (question) {
      console.log(question);
      const newAnswer: IAnswer[] = [...answers];
      if (question.title === 'Please select trim.') {
        console.log(
          question.title,
          question.options[0].items.map((el: any) => ({
            modelId: el.id,
            name: el.displayName,
          })),
        );
        newAnswer.push({
          addDeduct: [],
          book: question.book,
          isBlank: null,
          modelId: question.options[0].items[0].id,
        });
      } else
        newAnswer.push({
          book: question.book,
          addDeduct: question.options
            .map((option: any) =>
              option.items.map((item: any) => ({
                action: option.optionType,
                code: item.id,
              })),
            )
            .flat(),
          isBlank: null,
        });
      return this.getBuild(page, vin, token, newAnswer);
    }
    return vehicleBuilds;
  }

  async getSimilarVehicles(page: Page) { }
}
