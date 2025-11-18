import { Page } from 'puppeteer';
import { sendAPIRequest, sendFormRequest, Window } from '../class/window';
import { IAnswer, IQuestion } from '../interfaces/dealercenter.types';
import { InputAnswer, UserAnswer } from '../interfaces/dealercenter.validation';
import axios from 'axios';
import { filterItems } from '../lib/array';
import { fetchOtpWithBackoff } from './otp.service';
import { IVehicle } from 'interfaces/vehicle.types';
import { generateId } from '../utils/auction';

let loginPromise: Promise<void> | null = null;
let accessToken: string | null;
export class DCEngine {
  window: Window;
  screenshotDir: string;
  constructor() {
    this.window = new Window(true);
    this.screenshotDir = 'screenshots/dc/';
  }
  forceLogin(page: Page) {
    console.log('forceLogin', loginPromise);
    if (!loginPromise)
      loginPromise = new Promise((resolve, reject) => {
        this.interactiveLogin(page)
          .then(() => {
            console.log('Interactive Login Completed...');
            resolve();
            loginPromise = null;
          })
          .catch(reject);
      });
    return loginPromise;
  }
  async openScraper() {
    const page = await this.window.connectRemote(19203);
    return page;
  }
  async login(page: Page) {
    console.log('Login Invoked');
    try {
      const url = await page.url();
      console.log(url);
      if (
        url !== 'https://idsvr.dealercenter.net/authn/authentication/dcWebAuth'
      ) {
        console.log('Go to the Login Page.');
        await page.goto('https://dmsapp.dealercenter.net/Home/SignIn', {
          waitUntil: 'networkidle2',
        });
      }
      const loginBtn = await page.$('#login');
      console.log(`loginBtn is `, loginBtn != null);
      if (loginBtn) {
        await Promise.all([
          loginBtn.click(),
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
      }
    } catch (e) {
      console.log('Login Errr', e);

      // await page.reload();
      this.login(page);
    } finally {
      console.log('Login function called');
    }
  }
  async interactiveLogin(page: Page) {
    await this.login(page);

    const url = await page.url();
    if (url === 'https://idsvr.dealercenter.net/authn/authentication/WebMFA') {
      console.log('LOG: Trying to pass MFA');
      await page.goto(
        'https://idsvr.dealercenter.net/authn/authentication/WebMFAEmail',
        {
          waitUntil: 'networkidle2',
        },
      );
      const passcode = await fetchOtpWithBackoff(
        'http://localhost:8080/get-otp',
        100,
      );
      const res = await sendFormRequest(
        page,
        'https://idsvr.dealercenter.net/authn/authentication/WebMFAEmail/enter-otp',
        'POST',
        {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        {
          otp: passcode,
        },
      );
      if (res?.redirected) {
        console.log('LOG: SUCCESSFULLY PASSED MFA');
        await this.login(page);
      }
    }
  }
  setToken(token: string) {
    accessToken = token;
  }

  async getToken(page: Page) {
    try {
      console.log('AUTH: Validating token');
      const tokens = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/admin/userauth/public/validaterefreshtoken',
        'GET',
        {},
      );
      // console.log(tokens)
      if (!tokens || !tokens.userAccessToken) {
        console.log('Logged out');
        accessToken = null;
        return null;
      } else {
        accessToken = tokens.userAccessToken;
        return accessToken;
      }
    } catch (e) {
      console.log('AUTH: Error validating token', e);
      return null;
    } finally {
      console.log('AUth token: ', accessToken);
    }
  }

  /**
   * Retrieves the inventory ID associated with a given VIN (Vehicle Identification Number)
   * by making an API request to check for duplicates in the inventory.
   *
   * @param page - The Puppeteer `Page` instance used to perform the API request.
   * @param vin - The VIN (Vehicle Identification Number) to check for duplicates.
   * @returns A promise that resolves to the inventory ID if a duplicate is found, or `null` if no duplicate exists.
   */
  async getInventoryByVin(page: Page, vin: string): Promise<string | null> {
    const isDuplicated = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/CheckVinDuplicate',
      'POST',
      {
        Authorization: `Bearer ${accessToken}`,
      },
      {
        vin: vin,
        companyId: null,
      },
    );
    if (isDuplicated?.inventoryId) return isDuplicated.inventoryId;
    return null;
  }
  async getData(page: Page, vin: string, prompts?: UserAnswer) {
    const odometerInput = Number(
      (prompts?.find(
        el => el.type === 'input' && el.key === 'odometer',
      ) as InputAnswer)?.value,
    );
    console.log(odometerInput);
    const result: { [key: string]: any } = {};
    // const status = await this.checkModal(page);
    // if (status === Status.NOT_AUTHORIZED) {
    //   await this.login(page);
    //   await this.gotoAppraisalPage(page);
    // }res.proxy-seller.com:10000@31241e36f9f0b4f4:RNW78Fm5
    await this.getToken(page);
    console.log('TOKEN: ', accessToken);

    // Check VIN Duplicates
    const duplicateData = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/CheckVinDuplicate',
      'POST',
      {
        Authorization: `Bearer ${accessToken}`,
      },
      {
        vin: vin,
        companyId: null,
      },
    );
    console.log(duplicateData);
    if (duplicateData.inventoryId) {
      console.log('Already appraised vehicle');
      const { data: bookData } = await axios.post(
        'https://app.dealercenter.net/api-gateway/inventory/Inventory/LoadInventoryById',
        {
          inventoryId: duplicateData.inventoryId,
          loadOption: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 16, 11],
          setIsCurrentForBook: false,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
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

      const odometer = bookData.odometer ?? odometerInput;

      const { data: manheimValue } = await axios.post(
        'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
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
        { headers: { Authorization: `Bearer ${accessToken}` } },
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
        manheim: manheimValue.manheim.adjustedWholesaleAverage,
      };

      console.log('NOW GETTING VEHICLE POOLS');
      const { data: buildMatchingData } = await axios.post(
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/MarketDataBuildMatching',
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
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const locationPreset = [
        5,
        10,
        15,
        20,
        25,
        30,
        35,
        40,
        45,
        50,
        55,
        60,
        65,
        70,
        75,
        80,
        85,
        90,
        95,
        100,
        200,
        300,
        400,
        500,
        600,
        700,
        800,
        900,
        1000,
        5000,
      ];
      let locationIndex = 23;
      console.log(odometer);

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
        odometerMax: odometer + 15000 || null,
        odometerMin: odometer - 15000 || null,
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
      const vehicleInfo = {
        entityID: duplicateData.inventoryId,
        entityTypeID: 3,
        vin: vin,
        stockNumber: vehicleMeta.stockNumber,
        year: vehicleMeta.year,
        make: vehicleMeta.make,
        model: vehicleMeta.model,
        trim: vehicleMeta.trim,
        odometer: odometer,
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
      let previousCount = -1;
      let isSet = false;
      do {
        filters.radiusInMiles = locationPreset[locationIndex];
        console.log('Milage: ', locationPreset[locationIndex], filters);
        const { data: marketLookupData } = await axios.post(
          'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetFilterLookupData',
          {
            filters,
            maxDigitalPriceLockType: 1,
            vehicleInfo,
          },
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const count = marketLookupData.listings.reduce(
          (sum: number, item: any) => sum + item.count,
          0,
        );
        // Filter
        if (
          marketLookupData.transmissions.length &&
          !(filters.transmissions as any[]).includes(
            marketLookupData.transmissions[0].name,
          )
        ) {
          filters.transmissions = marketLookupData.transmissions.map(
            (el: any) => el.name,
          );
          console.log('reset');
          isSet = false;
          continue;
        }
        console.log('Result: ', count, previousCount, isSet);
        if (previousCount === -1) previousCount = count;
        if (count >= 10 && count < 20) {
          // this is an ideal case.
          break;
        }
        if (isSet && previousCount >= 20 && count < 10) {
          locationIndex += 1;
          filters.radiusInMiles = locationPreset[locationIndex];
          break;
        }
        if (isSet && previousCount < 9 && count >= 20) {
          locationIndex -= 1;
          filters.radiusInMiles = locationPreset[locationIndex];
          break;
        }
        if (isSet && previousCount < 10 && count < 10) {
          if (locationIndex < locationPreset.length - 1) locationIndex += 1;
          else {
            if (filters.odometerMax && filters.odometerMax + 15000 < 100000)
              filters.odometerMax += 15000;
            else filters.odometerMax = null;

            if (filters.odometerMin && filters.odometerMin - 15000 > 5000)
              filters.odometerMin -= 15000;
            else filters.odometerMin = null;

            if (filters.odometerMax === null && filters.odometerMin === null) {
              break;
            }
            isSet = false;
            continue;
          }
        }
        if (isSet && previousCount >= 20 && count >= 20) {
          if (locationIndex > 0) locationIndex -= 1;
          else break;
        }
        previousCount = count;
        isSet = true;
      } while (true);
      const { data: marketLookupStats } = await axios.post(
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=0',
        {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      console.log(marketLookupStats);

      const { data: priceRankingData } = await axios.post(
        `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetPriceRankings?matching=${marketLookupStats.vehicleCount}`,
        {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      console.log(priceRankingData);
      const { data: marketSupplyData } = await axios.post(
        `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketListDaysSupply`,
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
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      result['comp'] = marketSupplyData.items || [];
      result['isCompleted'] = true;
      result['metadata'] = vehicleMeta;
      return result;
      // return { isCompleted: false, error: 'Sold Item' };
      // console.log(marketSupplyData);
    }
    if (Number.isNaN(odometerInput)) {
      return {
        isCompleted: false,
        question: {
          type: 'input',
          key: 'odometer',
        },
      };
    }
    const answers: IAnswer[] = [];
    (prompts || [])
      .filter(el => el.type !== 'input')
      .forEach(prompt => {
        const exist = answers.find(answer => answer.book === prompt.book);
        if (!exist) {
          if (prompt.key === 'model' || prompt.key === 'trim')
            answers.push({
              book: prompt.book,
              isBlank: null,
              addDeduct: [],
              modelId: prompt.items.find(el => el.isChecked)?.id || undefined,
            });
          else {
            const items =
              prompt.type === 'select'
                ? filterItems(prompt.items)
                : prompt.type === 'checkbox'
                ? prompt.items
                : [];
            answers.push({
              book: prompt.book,
              isBlank: null,
              addDeduct: items.map(il => ({
                code: il.id,
                action: il.isChecked ? 0 : 1,
              })),
            });
          }
        } else {
          if (prompt.key === 'model' || prompt.key === 'trim')
            exist.modelId =
              prompt.items.find(el => el.isChecked)?.id || undefined;
          else {
            const items =
              prompt.type === 'select'
                ? filterItems(prompt.items)
                : prompt.type === 'checkbox'
                ? prompt.items
                : [];
            items.forEach(item => {
              const existItem = exist.addDeduct.find(el => el.code === item.id);
              if (existItem) {
                existItem.action = item.isChecked ? 0 : 1;
              } else {
                exist.addDeduct.push({
                  code: item.id,
                  action: item.isChecked ? 0 : 1,
                });
              }
            });
          }
        }
      });
    const {
      question,
      vehicleBuilds,
      cityMpg,
      vehicleWeight,
      highwayMpg,
      grossVehicleWeight,
    } = await this.getBuild(page, vin, accessToken!, answers);
    if (question) return { isCompleted: false, question };
    if (vehicleBuilds.length === 0)
      return { isCompleted: false, error: 'Not Valid Vin' };

    const { data: draftData } = await axios.get(
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/NewInventory?source=1',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

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
    const kbbBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 1,
    );

    const { data: valueData } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      {
        method: 1,
        odometer: odometerInput,
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
            equipmentIds: kbbBuildData.vehicleEquipments
              .filter((el: any) => el.checked)
              .map((el: any) => el.code),
            bookType: 1,
            modelId: kbbBuildData.modelIdentifier,
            vehicleBuildDTO: kbbBuildData,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log('Kelley:', {
      tradeInGood: valueData.kelley.tradeInGood,
      retailBook: valueData.kelley.retailBook,
    });
    const kelleyBuild = valueData.kelleyBuild;

    const nadaBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 2,
    );
    const { data: nadaValue } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      {
        method: 1,
        odometer: odometerInput,
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
            modelId: nadaBuildData.modelIdentifier,
            bookType: 2,
            bookPeriod: null,
            equipmentIds: nadaBuildData.vehicleEquipments
              .filter((el: any) => el.checked)
              .map((el: any) => el.code),
            vehicleBuildDTO: nadaBuildData,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const nadaBuild = nadaValue.nadaBuild;
    console.log('NADA(JD POWER):', {
      tradeAvgBook: nadaValue.nada?.tradeAvgBook,
      retailBook: nadaValue.nada?.retailBook,
    });
    const blackBookBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 3,
    );
    const { data: blackBookValue } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      {
        method: 1,
        odometer: odometerInput,
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
            modelId: blackBookBuildData.modelIdentifier,
            bookType: 3,
            bookPeriod: null,
            equipmentIds: blackBookBuildData.vehicleEquipments
              .filter((el: any) => el.checked)
              .map((el: any) => el.code),
            vehicleBuildDTO: blackBookBuildData,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log('Black Book Value: ', {
      retail: blackBookValue.blackBook?.totalRetailClean,
      trade:
        blackBookValue.blackBook?.baseTradeInAvg -
        blackBookValue.blackBook?.packageTradeInAvg,
    });
    const blackBookBuild = blackBookValue.blackBookBuild;
    const manheimBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 4,
    );
    const { data: manheimValue } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      {
        method: 1,
        odometer: odometerInput,
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
            vehicleBuildDTO: manheimBuildData,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(
      'Manheim Value:',
      manheimValue.manheim?.adjustedWholesaleAverage,
    );
    const manheimBuild = manheimValue.manheimBuild;
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
      manheim: manheimValue.manheim.adjustedWholesaleAverage,
    };
    result['isCompleted'] = true;

    console.log('NOW GETTING VEHICLE POOLS');
    // console.log(vehicleMeta);
    const { data: buildMatchingData } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/MarketDataBuildMatching',
      {
        marketCompleteMatching: true,
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
            odometer: odometerInput,
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
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(buildMatchingData);
    const locationPreset = [
      5,
      10,
      15,
      20,
      25,
      30,
      35,
      40,
      45,
      50,
      55,
      60,
      65,
      70,
      75,
      80,
      85,
      90,
      95,
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
      1000,
      5000,
    ];
    let locationIndex = 23;
    const filters = {
      bodyStyles: buildMatchingData.optionCollection.bodyStyles.map(
        (el: any) => el.name,
      ),
      driveTrains: buildMatchingData.optionCollection.drivetrains.map(
        (el: any) => el.name,
      ),
      engines: buildMatchingData.optionCollection.engines.map(
        (el: any) => el.name,
      ),
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
      odometerMax: odometerInput + 15000 || null,
      odometerMin: odometerInput - 15000 || null,
      packages: [],
      radiusInMiles: 0,
      transmissions: buildMatchingData.optionCollection.transmissions.map(
        (el: any) => el.name,
      ),
      trims: buildMatchingData.optionCollection.trims
        .map((el: any) => el.name)
        .filter((el: any) => el.toLowerCase() !== 'base'),
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
      odometer: odometerInput,
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

    let previousCount = -1;
    let isSet = false;
    do {
      filters.radiusInMiles = locationPreset[locationIndex];
      console.log('Milage: ', locationPreset[locationIndex], filters);
      const { data: marketLookupData } = await axios.post(
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetFilterLookupData',
        {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const count = marketLookupData.listings.reduce(
        (sum: number, item: any) => sum + item.count,
        0,
      );
      // Filter
      if (
        marketLookupData.transmissions.length &&
        !filters.transmissions.includes(marketLookupData.transmissions[0].name)
      ) {
        filters.transmissions = marketLookupData.transmissions.map(
          (el: any) => el.name,
        );
        console.log('reset');
        isSet = false;
        continue;
      }
      console.log('Result: ', count, previousCount, isSet);
      if (previousCount === -1) previousCount = count;
      if (count >= 10 && count < 20) {
        // this is an ideal case.
        break;
      }
      if (isSet && previousCount >= 20 && count < 10) {
        locationIndex += 1;
        filters.radiusInMiles = locationPreset[locationIndex];
        break;
      }
      if (isSet && previousCount < 9 && count >= 20) {
        locationIndex -= 1;
        filters.radiusInMiles = locationPreset[locationIndex];
        break;
      }
      if (isSet && previousCount < 10 && count < 10) {
        if (locationIndex < locationPreset.length - 1) locationIndex += 1;
        else {
          if (filters.odometerMax && filters.odometerMax + 15000 < 100000)
            filters.odometerMax += 15000;
          else filters.odometerMax = null;

          if (filters.odometerMin && filters.odometerMin - 15000 > 5000)
            filters.odometerMin -= 15000;
          else filters.odometerMin = null;

          if (filters.odometerMax === null && filters.odometerMin === null) {
            break;
          }
          isSet = false;
          continue;
        }
      }
      if (isSet && previousCount >= 20 && count >= 20) {
        if (locationIndex > 0) locationIndex -= 1;
        else break;
      }
      previousCount = count;
      isSet = true;
    } while (true);
    const { data: marketLookupStats } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=0',
      {
        filters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(marketLookupStats);

    const { data: priceRankingData } = await axios.post(
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetPriceRankings?matching=${marketLookupStats.vehicleCount}`,
      {
        filters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const { data: marketStatisticsData } = await axios.post(
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=${marketLookupStats.vehicleCount}`,
      {
        filters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(priceRankingData.length, marketStatisticsData);
    const { data: marketSupplyData } = await axios.post(
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketListDaysSupply`,
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
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    result['comp'] = marketSupplyData.items || [];
    result['isCompleted'] = true;
    result['metadata'] = vehicleMeta;
    // console.log(marketSupplyData);

    return result;

    // SAVE APPRAISAL

    draftData['onlineMarketingDescription'] = {
      checksum: null,
      description: null,
      id: '00000000-0000-0000-0000-000000000000',
      inventoryId: '00000000-0000-0000-0000-000000000000',
      objectState: 0,
      template: null,
    };
    draftData['odometer'] = odometerInput;
    draftData['currentAppraisalValue'] = marketStatisticsData.priceAvg;
    draftData['vehWeight'] = vehicleWeight;
    draftData['highwayMpg'] = highwayMpg;
    draftData['cityMpg'] = cityMpg;
    draftData['vehicleBuilds'] = [
      kelleyBuild,
      nadaBuild,
      blackBookBuild,
      manheimBuild,
    ];
    draftData['grossVehicleWeight'] = grossVehicleWeight;
    draftData['vin'] = vin;

    const { data: savedResult } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/SaveInventory',
      {
        changeSource: 'web',
        saveOption: null,
        inventory: draftData,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const { data: getDescriptionInventory } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/OnlineMarketingDescription/GetDescriptionInventory',
      {
        ...draftData,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    console.log(savedResult);

    const entityID = savedResult.id;
    vehicleInfo.entityID = entityID;
    const { data: savePricingFilter } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/SaveMarketPriceFilter',
      {
        entityID,
        entityTypeID: 3,
        marketDataProviderID: 1,
        marketDataRequest: {
          filters,
          maxDigitalPriceLockType: 0,
          vehicleInfo,
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    console.log(savePricingFilter);
    // const marketPricingID = savePricingFilter.id;

    // const { data: saveMarketPricingDetail } = await axios.post('https://app.dealercenter.net/api-gateway/inventory/MarketData/SaveMarketPricingDetail', {
    //   appraisedBy: "08ff48cb-f0c7-4bff-8b66-8d069128d879",
    //   appraisedByName: "Appraisal Manager - appraisalmanager",
    //   avgOdometer: marketSupplyData.odometerAvg,
    //   avgPrice: marketSupplyData.priceAvg,
    //   entityID,
    //   entityTypeID: 3,
    //   marketDataProviderID: 1,
    //   marketDaySupply: marketSupplyData.matching,
    //   marketPrice: marketSupplyData.priceAvg * 0.98,
    //   marketPricingID,
    //   marketPricingRequestID: marketSupplyData.marketPricingRequestID,
    //   matchedVehicleCount: marketSupplyData.vehicleCount,
    //   maxPrice: marketSupplyData.priceMax,
    //   maxRank: marketSupplyData.vehicleCount,
    //   minPrice: marketSupplyData.priceMin,
    //   overallVehicleCount: overallCount,
    //   rank: 4,
    //   reconEstimate: 0,
    //   totalGrossProfit: 0
    // }, { headers: { Authorization: `Bearer ${accessToken}` }, })
    // console.log(saveMarketPricingDetail);
  }
  async registerInventory(page: Page, vehicle: IVehicle) {
    const { vin, odometer } = vehicle;
    const {
      vehicleBuilds,
      cityMpg,
      vehicleWeight,
      highwayMpg,
      grossVehicleWeight,
    } = await this.completeVehicleBuild(page, vehicle);
    if (vehicleBuilds.length === 0)
      return { isCompleted: false, error: 'Not Valid Vin' };

    const { data: draftData } = await axios.get(
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/NewInventory?source=1',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

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
    const kbbBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 1,
    );

    const { data: valueData } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      {
        method: 1,
        odometer: odometer,
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
            equipmentIds: kbbBuildData.vehicleEquipments
              .filter((el: any) => el.checked)
              .map((el: any) => el.code),
            bookType: 1,
            modelId: kbbBuildData.modelIdentifier,
            vehicleBuildDTO: kbbBuildData,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log('Kelley:', {
      tradeInGood: valueData.kelley.tradeInGood,
      retailBook: valueData.kelley.retailBook,
    });
    const kelleyBuild = valueData.kelleyBuild;

    const nadaBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 2,
    );
    const { data: nadaValue } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
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
            region: 'IA',
            modelId: nadaBuildData.modelIdentifier,
            bookType: 2,
            bookPeriod: null,
            equipmentIds: nadaBuildData.vehicleEquipments
              .filter((el: any) => el.checked)
              .map((el: any) => el.code),
            vehicleBuildDTO: nadaBuildData,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const nadaBuild = nadaValue.nadaBuild;
    const blackBookBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 3,
    );
    const { data: blackBookValue } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
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
            region: 'IL',
            modelId: blackBookBuildData.modelIdentifier,
            bookType: 3,
            bookPeriod: null,
            equipmentIds: blackBookBuildData.vehicleEquipments
              .filter((el: any) => el.checked)
              .map((el: any) => el.code),
            vehicleBuildDTO: blackBookBuildData,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const blackBookBuild = blackBookValue.blackBookBuild;
    const manheimBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 4,
    );
    const { data: manheimValue } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
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
            vehicleBuildDTO: manheimBuildData,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const manheimBuild = manheimValue.manheimBuild;

    console.log('NOW GETTING VEHICLE POOLS');
    // console.log(vehicleMeta);
    const { data: buildMatchingData } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/MarketDataBuildMatching',
      {
        marketCompleteMatching: true,
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
            odometer,
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
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(buildMatchingData);
    const locationPreset = [
      5,
      10,
      15,
      20,
      25,
      30,
      35,
      40,
      45,
      50,
      55,
      60,
      65,
      70,
      75,
      80,
      85,
      90,
      95,
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
      1000,
      5000,
    ];
    let locationIndex = 23;
    const filters = {
      bodyStyles: buildMatchingData.optionCollection.bodyStyles.map(
        (el: any) => el.name,
      ),
      driveTrains: buildMatchingData.optionCollection.drivetrains.map(
        (el: any) => el.name,
      ),
      engines: buildMatchingData.optionCollection.engines.map(
        (el: any) => el.name,
      ),
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
      odometerMax: odometer + 15000 || null,
      odometerMin: odometer - 15000 || null,
      packages: [],
      radiusInMiles: 0,
      transmissions: buildMatchingData.optionCollection.transmissions.map(
        (el: any) => el.name,
      ),
      trims: buildMatchingData.optionCollection.trims
        .map((el: any) => el.name)
        .filter((el: any) => el.toLowerCase() !== 'base'),
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
      odometer,
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

    let previousCount = -1;
    let isSet = false;
    do {
      filters.radiusInMiles = locationPreset[locationIndex];
      console.log('Milage: ', locationPreset[locationIndex], filters);
      const { data: marketLookupData } = await axios.post(
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetFilterLookupData',
        {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const count = marketLookupData.listings.reduce(
        (sum: number, item: any) => sum + item.count,
        0,
      );
      // Filter
      if (
        marketLookupData.transmissions.length &&
        !filters.transmissions.includes(marketLookupData.transmissions[0].name)
      ) {
        filters.transmissions = marketLookupData.transmissions.map(
          (el: any) => el.name,
        );
        console.log('reset');
        isSet = false;
        continue;
      }
      console.log('Result: ', count, previousCount, isSet);
      if (previousCount === -1) previousCount = count;
      if (count >= 10 && count < 20) {
        // this is an ideal case.
        break;
      }
      if (isSet && previousCount >= 20 && count < 10) {
        locationIndex += 1;
        filters.radiusInMiles = locationPreset[locationIndex];
        break;
      }
      if (isSet && previousCount < 9 && count >= 20) {
        locationIndex -= 1;
        filters.radiusInMiles = locationPreset[locationIndex];
        break;
      }
      if (isSet && previousCount < 10 && count < 10) {
        if (locationIndex < locationPreset.length - 1) locationIndex += 1;
        else {
          if (filters.odometerMax && filters.odometerMax + 15000 < 100000)
            filters.odometerMax += 15000;
          else filters.odometerMax = null;

          if (filters.odometerMin && filters.odometerMin - 15000 > 5000)
            filters.odometerMin -= 15000;
          else filters.odometerMin = null;

          if (filters.odometerMax === null && filters.odometerMin === null) {
            break;
          }
          isSet = false;
          continue;
        }
      }
      if (isSet && previousCount >= 20 && count >= 20) {
        if (locationIndex > 0) locationIndex -= 1;
        else break;
      }
      previousCount = count;
      isSet = true;
    } while (true);
    const { data: marketLookupStats } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=0',
      {
        filters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(marketLookupStats);

    const { data: priceRankingData } = await axios.post(
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetPriceRankings?matching=${marketLookupStats.vehicleCount}`,
      {
        filters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const { data: marketStatisticsData } = await axios.post(
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=${marketLookupStats.vehicleCount}`,
      {
        filters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(priceRankingData.length, marketStatisticsData);
    const { data: marketSupplyData } = await axios.post(
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketListDaysSupply`,
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
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    // SAVE APPRAISAL

    draftData['onlineMarketingDescription'] = {
      checksum: null,
      description: null,
      id: '00000000-0000-0000-0000-000000000000',
      inventoryId: '00000000-0000-0000-0000-000000000000',
      objectState: 0,
      template: null,
    };
    draftData['odometer'] = odometer;
    draftData['currentAppraisalValue'] = marketStatisticsData.priceAvg;
    draftData['vehWeight'] = vehicleWeight;
    draftData['highwayMpg'] = highwayMpg;
    draftData['cityMpg'] = cityMpg;
    draftData['vehicleBuilds'] = [
      kelleyBuild,
      nadaBuild,
      blackBookBuild,
      manheimBuild,
    ];
    draftData['grossVehicleWeight'] = grossVehicleWeight;
    draftData['vin'] = vin;

    const { data: savedResult } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/SaveInventory',
      {
        changeSource: 'web',
        saveOption: null,
        inventory: draftData,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const { data: getDescriptionInventory } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/OnlineMarketingDescription/GetDescriptionInventory',
      {
        ...draftData,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    console.log(savedResult);

    const entityID = savedResult.id;
    vehicleInfo.entityID = entityID;
    const { data: savePricingFilter } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/SaveMarketPriceFilter',
      {
        entityID,
        entityTypeID: 3,
        marketDataProviderID: 1,
        marketDataRequest: {
          filters,
          maxDigitalPriceLockType: null,
          vehicleInfo,
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    console.log(savePricingFilter);
    return entityID;
    // const marketPricingID = savePricingFilter.id;

    // const { data: saveMarketPricingDetail } = await axios.post('https://app.dealercenter.net/api-gateway/inventory/MarketData/SaveMarketPricingDetail', {
    //   appraisedBy: "08ff48cb-f0c7-4bff-8b66-8d069128d879",
    //   appraisedByName: "Appraisal Manager - appraisalmanager",
    //   avgOdometer: marketSupplyData.odometerAvg,
    //   avgPrice: marketSupplyData.priceAvg,
    //   entityID,
    //   entityTypeID: 3,
    //   marketDataProviderID: 1,
    //   marketDaySupply: marketSupplyData.matching,
    //   marketPrice: marketSupplyData.priceAvg * 0.98,
    //   marketPricingID,
    //   marketPricingRequestID: marketSupplyData.marketPricingRequestID,
    //   matchedVehicleCount: marketSupplyData.vehicleCount,
    //   maxPrice: marketSupplyData.priceMax,
    //   maxRank: marketSupplyData.vehicleCount,
    //   minPrice: marketSupplyData.priceMin,
    //   overallVehicleCount: overallCount,
    //   rank: 4,
    //   reconEstimate: 0,
    //   totalGrossProfit: 0
    // }, { headers: { Authorization: `Bearer ${accessToken}` }, })
    // console.log(saveMarketPricingDetail);
  }
  async adjustFilters(page: Page, filters: any, vehicleInfo: any) {
    // vehicleInfo.odometer = odometer;
    const locationPreset = [
      5,
      10,
      15,
      20,
      25,
      30,
      35,
      40,
      45,
      50,
      55,
      60,
      65,
      70,
      75,
      80,
      85,
      90,
      95,
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
      1000,
      5000,
    ];
    let locationIndex =
      locationPreset.indexOf(filters.radiusInMiles) > -1
        ? locationPreset.indexOf(filters.radiusInMiles)
        : 23;
    let previousCount = -1;
    let isSet = false;
    let marketLookupData: any = null;
    do {
      filters.radiusInMiles = locationPreset[locationIndex];
      console.log('Milage: ', locationPreset[locationIndex], filters);
      marketLookupData = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetFilterLookupData',
        'POST',
        { Authorization: `Bearer ${accessToken}` },
        {
          filters,
          maxDigitalPriceLockType: 1,
          vehicleInfo,
        },
      );
      const count = marketLookupData.listings.reduce(
        (sum: number, item: any) => sum + item.count,
        0,
      );
      // Filter
      if (
        marketLookupData.transmissions.length &&
        !filters.transmissions.includes(marketLookupData.transmissions[0].name)
      ) {
        filters.transmissions = marketLookupData.transmissions.map(
          (el: any) => el.name,
        );
        console.log('reset');
        isSet = false;
        continue;
      }
      console.log('Result: ', count, previousCount, isSet);
      if (previousCount === -1) previousCount = count;
      if (count >= 10 && count < 20) {
        // this is an ideal case.
        break;
      }
      if (isSet && previousCount >= 20 && count < 10) {
        locationIndex += 1;
        filters.radiusInMiles = locationPreset[locationIndex];
        break;
      }
      if (isSet && previousCount < 9 && count >= 20) {
        locationIndex -= 1;
        filters.radiusInMiles = locationPreset[locationIndex];
        break;
      }
      if (isSet && previousCount < 10 && count < 10) {
        if (locationIndex < locationPreset.length - 1) locationIndex += 1;
        else {
          if (filters.odometerMax && filters.odometerMax + 15000 < 100000)
            filters.odometerMax += 15000;
          else filters.odometerMax = null;

          if (filters.odometerMin && filters.odometerMin - 15000 > 5000)
            filters.odometerMin -= 15000;
          else filters.odometerMin = null;

          if (filters.odometerMax === null && filters.odometerMin === null) {
            break;
          }
          isSet = false;
          continue;
        }
      }
      if (isSet && previousCount >= 20 && count >= 20) {
        if (locationIndex > 0) locationIndex -= 1;
        else break;
      }
      previousCount = count;
      isSet = true;
    } while (true);
    return { filters, marketLookupData };
  }
  async completeVehicleBuild(page: Page, vehicle: IVehicle) {
    const answer: IAnswer[] = [];

    do {
      const {
        question,
        vehicleBuilds,
        cityMpg,
        vehicleWeight,
        highwayMpg,
        grossVehicleWeight,
      } = await this.getBuild(page, vehicle.vin, accessToken!, answer);
      if (!question) {
        return {
          vehicleBuilds,
          cityMpg,
          vehicleWeight,
          highwayMpg,
          grossVehicleWeight,
        };
      }
      if (question.type === 'checkbox') {
        // select all options
        answer.push({
          book: question.book,
          addDeduct: question.items.map((el: any) => ({
            action: 1,
            code: el.id,
          })),
          isBlank: null,
        });
        continue;
      }
      throw new Error('Not implemented');
    } while (true);
  }
  async getBuild(
    page: Page,
    vin: string,
    token: string,
    answers: Array<IAnswer>,
  ): Promise<{
    question: any;
    vehicleBuilds: any;
    highwayMpg: number;
    cityMpg: number;
    vehicleWeight: number;
    grossVehicleWeight: number;
  }> {
    const resp = await sendAPIRequest(
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
    const {
      data: {
        question,
        highwayMpg,
        cityMpg,
        vehicleWeight,
        vehicleBuilds,
        grossVehicleWeight,
      },
    } = resp;
    // if (!vehicleBuilds) throw new Error('Invalid VIN');
    const questionObj: IQuestion | undefined =
      question && question.options.length > 0
        ? {
            book: question.book,
            key: question.options[0].subTitle?.toLowerCase() || '',
            items: question.options[0].items.map((el: any) => ({
              id: el.id,
              name: el.displayName,
            })),
            type: question.options[0].optionType === 1 ? 'checkbox' : 'select',
          }
        : undefined;
    if (question && questionObj) {
      if (question.title.toLowerCase() === 'please select trim.')
        questionObj.key = 'trim';
    }
    return {
      question: questionObj,
      vehicleBuilds,
      highwayMpg,
      cityMpg,
      vehicleWeight,
      grossVehicleWeight,
    };

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
  async getMarketPriceFilter(page: Page, inventoryId: string) {
    const data = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceFilter',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        maxPriceInventoryAuctionRequest: {
          entityID: inventoryId,
          entityTypeID: 3,
          marketDataProviderID: 1,
        },
      },
    );
    console.log(data);
    const {
      id,
      companyId,
      marketDataRequest: { filters, vehicleInfo },
    } = data;
    return { filters, vehicleInfo, id, companyId };
  }
  async getMarketPrice(page: Page, filters: any, vehicleInfo: any) {
    const marketLookupStats = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=0',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        filters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
    );
    return marketLookupStats;
  }
  async getInventoryDetails(page: Page, inventoryId: string) {
    const data = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/LoadInventoryById',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        inventoryId: inventoryId,
        loadOption: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 16, 11],
        setIsCurrentForBook: false,
      },
    );
    return data;
  }
  async getInventoryValuation(
    page: Page,
    vin: string,
    odometer: number,
    vehicleMeta: any,
    vehicleBuilds: any,
  ) {
    const kbbBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 1,
    );
    const nadaBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 2,
    );
    const blackBookBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 3,
    );
    const manheimBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 4,
    );
    const data = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        vin: vin,
        method: 1,
        odometer: odometer,
        vehicleType: 1,
        isTitleBrandCommercial: false,
        hasExistingNadaBooked: true,
        hasExistingBBBooked: true,
        year: vehicleMeta.year,
        make: vehicleMeta.make,
        modelName: vehicleMeta.model,
        trim: vehicleMeta.trim,
        bookPeriod: null,
        vehicleBuilds: [
          {
            region: '92683',
            bookPeriod: null,
            equipmentIds: kbbBuildData.vehicleEquipments
              .filter((el: any) => el.checked)
              .map((el: any) => el.code),
            bookType: 1,
            modelId: kbbBuildData.modelIdentifier,
            vehicleBuildDTO: kbbBuildData,
          },
          {
            region: 'IA',
            modelId: nadaBuildData.modelIdentifier,
            bookType: 2,
            bookPeriod: null,
            equipmentIds: nadaBuildData.vehicleEquipments
              .filter((el: any) => el.checked)
              .map((el: any) => el.code),
            vehicleBuildDTO: nadaBuildData,
          },
          {
            region: 'IL',
            modelId: blackBookBuildData.modelIdentifier,
            bookType: 3,
            bookPeriod: null,
            equipmentIds: blackBookBuildData.vehicleEquipments
              .filter((el: any) => el.checked)
              .map((el: any) => el.code),
            vehicleBuildDTO: blackBookBuildData,
          },
          {
            region: 'NA',
            color: 'Black',
            grade: 43,
            bookType: 4,
            vehicleBuildDTO: manheimBuildData,
          },
        ],
      },
    );
    return data;
  }
  async saveInventoryDetails(
    page: Page,
    inventoryData: any,
    inventoryId: string,
    companyId: string,
    filterId: string,
    filters: any,
    vehicleInfo: any,
  ) {
    const data = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/SaveInventory',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        changeSource: 'web',
        saveOption: null,
        inventory: inventoryData,
      },
    );
    await this.saveMarketPricingFilter(
      page,
      inventoryId,
      companyId,
      filterId,
      filters,
      vehicleInfo,
    );
  }
  async saveNote(page: Page, inventoryId: string, note: string) {
    const data = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/Activities/SaveActivity',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        activityTypeId: 8,
        activityStatusId: 2,
        assignedToUserId: '08ff48cb-f0c7-4bff-8b66-8d069128d879',
        assignedToUserName: 'appraisalmanager',
        primaryEntityTypeId: 3,
        createdBy: '35d89df9-6930-4e71-b505-e65ada84e403',
        note: {
          note,
        },
        primaryEntityId: inventoryId,
      },
    );
    return data;
  }
  async saveMarketPricingFilter(
    page: Page,
    inventoryId: string,
    companyId: string,
    filterId: string,
    filters: any,
    vehicleInfo: any,
  ) {
    const savePricingFilter = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/SaveMarketPriceFilter',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        entityID: inventoryId,
        entityTypeID: 3,
        companyId,
        id: filterId,
        marketDataProviderID: 1,
        marketDataRequest: {
          filters,
          maxDigitalPriceLockType: 1,
          vehicleInfo,
        },
      },
    );
    return savePricingFilter;
  }
  async getPriceRanking(
    page: Page,
    filters: any,
    vehicleInfo: any,
    matching = 0,
  ) {
    const priceRankingData = await sendAPIRequest(
      page,
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetPriceRankings?matching=${matching}`,
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        filters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
    );
    return priceRankingData;
  }
  async getMarketPricingID(page: Page, inventoryId: string) {
    const marketPriceingDetail = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPricingDetail',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        entityID: inventoryId,
        entityTypeID: 3,
        marketDataProviderID: 1,
      },
    );
    const lastMarketPricingDetail = marketPriceingDetail.length
      ? marketPriceingDetail[0]
      : null;
    if (!lastMarketPricingDetail) return generateId();
    return lastMarketPricingDetail.marketPricingID as string;
  }
  async saveMarketPricingDetail(page: Page, info: object) {
    const data = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/SaveMarketPricingDetail',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        appraisedBy: '08ff48cb-f0c7-4bff-8b66-8d069128d879',
        appraisedByName: 'Appraisal Manager - appraisalmanager',
        ...info,
      },
    );
    // console.log(saveMarketPricingDetail);
    return data;
  }
}
