import { Page } from 'puppeteer';
import { sendAPIRequest, sendFormRequest, Window } from '../class/window';
import { IAnswer, IQuestion } from '../interfaces/dealercenter.types';
import { InputAnswer, UserAnswer } from '../interfaces/dealercenter.validation';
import axios from 'axios';
import { filterItems } from '../lib/array';
import { fetchOtpWithBackoff } from './otp.service';
import { IVehicle } from 'interfaces/vehicle.types';
import { generateId } from '../utils/auction';
import { findBestMatch } from '../utils/stringSimilarity';
import { UncoveredCaseError } from '../errors/uncoveredCaseError';
import { NoVehicleDataError } from '../errors/noVehicleDataError';

const FILTER_LOG_PREFIX = '[MarketFilters]';
const LOCATION_RADIUS_PRESET = [
  5,
  10,
  20,
  30,
  40,
  50,
  60,
  70,
  80,
  90,
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
const TARGET_COMP_MIN = 10;
const TARGET_COMP_MAX = 13;
const RADIUS_WEIGHT = 3;
const MILEAGE_WEIGHT = 4;
const TRANSMISSION_WEIGHT = 0.6;
const IS_ACTIVE_WEIGHT = 3;
const MILEAGE_STEP = 7500;
const MILEAGE_STEP_HIGH = 15000;
const MILEAGE_STEP_THRESHOLD = 130000;
const MIN_ODOMETER_LIMIT = 5000;
const MAX_ODOMETER_LIMIT = 500000;
const DEFAULT_ODOMETER_MAX = MAX_ODOMETER_LIMIT;
const MAX_SEARCH_ITERATIONS = 80;
type TransmissionMode = 'original' | 'expanded';

interface FilterSearchState {
  radiusIdx: number;
  odometerMin: number | null;
  odometerMax: number | null;
  isActive: 0 | 1;
  transmissionsMode: TransmissionMode;
  transmissions: string[] | null;
  cost: number;
  depth: number;
  score?: number;
}

interface EvaluationResult {
  filters: any;
  marketLookupData: any;
  count: number;
}

interface CandidateEvaluation {
  state: FilterSearchState;
  evaluation: EvaluationResult;
  axis: string;
  delta: number;
  weightedScore: number;
}

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
      if (!url.startsWith('https://auth.dealercenter.net/u/login?')) {
        console.log('Go to the Login Page.');
        await page.goto('https://dmsapp.dealercenter.net/Home/SignIn', {
          waitUntil: 'networkidle2',
        });
      }
      const loginBtn = await page.$('#auth0-login-widget button[data-action-button-primary="true"]');
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
    if (url.includes('mfa-sms-challenge')) {
      console.log('LOG: Trying to pass MFA');
      // Select Mail option
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('button[type="submit"][name="action"][value="pick-authenticator"]'),
      ]);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('button[type="submit"][name="action"][value="email::1"]')
      ]);

      const passcode = await fetchOtpWithBackoff(
        'http://localhost:8080/get-otp',
        100,
      );

      // fill the input field
      await page.type('input[name="code"][autocomplete="off"]', passcode ?? ''); // replace '123456' with your actual code

      // click the "Continue" button
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }),
        page.click('button[type="submit"][value="default"]')
      ]);

      console.log('LOG: SUCCESSFULLY PASSED MFA');
      await this.login(page);
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

      // Check if buildMatchingData is null and throw error
      if (!buildMatchingData) {
        throw new NoVehicleDataError(vin, duplicateData.inventoryId);
      }

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
        bodyStyles: [],
        driveTrains: [],
        engines: [],
        equipments: [],
        fuelTypes: [],
        geoCoordinate: null,
        isActive: 0,
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
      questions,
      vehicleBuilds,
      cityMpg,
      vehicleWeight,
      highwayMpg,
      grossVehicleWeight,
    } = await this.getBuild(page, vin, accessToken!, answers);
    if (questions.length > 0) {
      // Return the first question for backward compatibility
      return { isCompleted: false, question: questions[0] };
    }
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

    // Check if buildMatchingData is null and throw error
    if (!buildMatchingData) {
      throw new NoVehicleDataError(vin);
    }
    const initialFilters = {
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
      model: initialFilters.modelAggregate.length
        ? initialFilters.modelAggregate[0]
        : vehicleMeta.model,
      trim: initialFilters.trims.length
        ? initialFilters.trims[0]
        : vehicleMeta.trim,
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

    const {
      filters: adjustedFilters,
      marketLookupData,
    } = await this.adjustFilters(page, initialFilters, vehicleInfo);
    const { data: marketLookupStats } = await axios.post(
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=0',
      {
        filters: adjustedFilters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(marketLookupStats);

    const { data: priceRankingData } = await axios.post(
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetPriceRankings?matching=${marketLookupStats.vehicleCount}`,
      {
        filters: adjustedFilters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const { data: marketStatisticsData } = await axios.post(
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=${marketLookupStats.vehicleCount}`,
      {
        filters: adjustedFilters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(priceRankingData.length, marketStatisticsData);
    const { data: marketSupplyData } = await axios.post(
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketListDaysSupply`,
      {
        filters: adjustedFilters,
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
          filters: adjustedFilters,
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
  async registerInventory(
    page: Page,
    vehicle: IVehicle,
  ): Promise<{
    isCompleted: boolean;
    error: string | null;
    autoSelection?: {
      key: string;
      vin: string;
      selectedOption: { id: string; name: string };
      availableOptions: Array<{ id: string; name: string }>;
      vehicleTrim?: string;
      inventoryId?: string;
    };
  }> {
    const { vin, odometer } = vehicle;
    const {
      vehicleBuilds,
      cityMpg,
      vehicleWeight,
      highwayMpg,
      grossVehicleWeight,
      autoSelection,
    } = await this.completeVehicleBuild(page, vehicle);
    if (vehicleBuilds.length === 0)
      return {
        isCompleted: false,
        error: 'Not Valid Vin',
        autoSelection,
      };

    const draftData = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/NewInventory?source=1',
      'GET',
      { Authorization: `Bearer ${accessToken}` },
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/NewInventory?source=1',
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

    const valueData = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
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
    );

    const kelleyBuild = valueData.kelleyBuild;

    const nadaBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 2,
    );
    const nadaValue = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
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
    );
    const nadaBuild = nadaValue.nadaBuild;
    const blackBookBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 3,
    );
    const blackBookValue = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
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
    );

    const blackBookBuild = blackBookValue.blackBookBuild;
    const manheimBuildData = vehicleBuilds.find(
      (el: any) => el.bookServiceTypeId === 4,
    );
    const manheimValue = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
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
    );

    const manheimBuild = manheimValue.manheimBuild;

    console.log('NOW GETTING VEHICLE POOLS');
    // console.log(vehicleMeta);
    const buildMatchingData = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/MarketDataBuildMatching',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
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
    );

    // Check if buildMatchingData is null and throw error
    if (!buildMatchingData.optionCollection) {
      throw new NoVehicleDataError(vin);
    }

    const initialFilters = {
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
      isActive: 0,
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
      model: initialFilters.modelAggregate.length
        ? initialFilters.modelAggregate[0]
        : vehicleMeta.model,
      trim: initialFilters.trims.length
        ? initialFilters.trims[0]
        : vehicleMeta.trim,
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

    const {
      filters: adjustedFilters,
      marketLookupData,
    } = await this.adjustFilters(page, initialFilters, vehicleInfo);
    const marketLookupStats = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=0',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      { filters: adjustedFilters, maxDigitalPriceLockType: null, vehicleInfo },
    );

    const priceRankingData = await sendAPIRequest(
      page,
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetPriceRankings?matching=${marketLookupStats.vehicleCount}`,
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        filters: adjustedFilters,
        maxDigitalPriceLockType: null,
        vehicleInfo,
      },
    );
    const marketStatisticsData = await sendAPIRequest(
      page,
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketPriceStatistics?mathching=${marketLookupStats.vehicleCount}`,
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      { filters: adjustedFilters, maxDigitalPriceLockType: null, vehicleInfo },
    );
    const marketSupplyData = await sendAPIRequest(
      page,
      `https://app.dealercenter.net/api-gateway/inventory/MarketData/GetMarketListDaysSupply`,
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        filters: adjustedFilters,
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
    draftData['vehiclePrice '] = 0;
    draftData['accountingAssetTypeId'] = 2;

    const savedResult = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/Inventory/SaveInventory',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      { changeSource: 'web', saveOption: null, inventory: draftData },
    );

    const getDescriptionInventory = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/OnlineMarketingDescription/GetDescriptionInventory',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      { ...draftData },
    );

    const entityID = savedResult.id;
    vehicleInfo.entityID = entityID;
    const savePricingFilter = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/SaveMarketPriceFilter',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        entityID,
        entityTypeID: 3,
        marketDataProviderID: 1,
        marketDataRequest: {
          filters: adjustedFilters,
          maxDigitalPriceLockType: null,
          vehicleInfo,
        },
      },
    );

    // Add inventoryId to autoSelection if present
    const autoSelectionWithInventoryId = autoSelection
      ? { ...autoSelection, inventoryId: entityID }
      : undefined;

    return {
      isCompleted: true,
      error: null,
      autoSelection: autoSelectionWithInventoryId as any,
    };
    // console.log(saveMarketPricingDetail);
  }
  async adjustFilters(page: Page, filters: any, vehicleInfo: any) {
    console.log(
      `${FILTER_LOG_PREFIX} Using weighted strategy, radius=${filters.radiusInMiles}, ` +
      `odometerRange=${filters.odometerMin ?? 'null'}-${filters.odometerMax ??
      'null'}, ` +
      `isActive=${filters.isActive ?? 0}`,
    );
    return this.adjustFiltersWeighted(page, filters, vehicleInfo);
  }

  private async adjustFiltersWeighted(
    page: Page,
    filters: any,
    vehicleInfo: any,
  ) {
    const baseFilters = this.cloneFilters(filters);
    const baseTransmissions = Array.isArray(baseFilters.transmissions)
      ? [...baseFilters.transmissions]
      : null;
    const initialRange =
      this.getInitialOdometerRange(vehicleInfo) ||
      this.getNarrowOdometerRange(
        vehicleInfo,
        baseFilters.odometerMin,
        baseFilters.odometerMax,
      );

    const initialState: FilterSearchState = {
      radiusIdx: 0,
      odometerMin: initialRange.min,
      odometerMax: initialRange.max,
      isActive: 0,
      transmissionsMode: 'original',
      transmissions: baseTransmissions ? [...baseTransmissions] : null,
      cost: 0,
      depth: 0,
    };

    let iterations = 0;
    const evaluationCache = new Map<string, EvaluationResult>();
    let currentState = initialState;
    let hasTriedIsActive1 = false; // Track if we've already tried isActive=1

    let currentEvaluation = await this.getEvaluation(
      page,
      vehicleInfo,
      baseFilters,
      baseTransmissions,
      currentState,
      evaluationCache,
    );
    let currentDelta = this.getCountDelta(currentEvaluation.count);
    let bestResult: CandidateEvaluation = {
      state: currentState,
      evaluation: currentEvaluation,
      axis: 'start',
      delta: currentDelta,
      weightedScore: currentDelta * RADIUS_WEIGHT,
    };

    if (
      currentEvaluation.count >= TARGET_COMP_MIN &&
      currentEvaluation.count <= TARGET_COMP_MAX
    ) {
      return {
        filters: currentEvaluation.filters,
        marketLookupData: currentEvaluation.marketLookupData,
      };
    }

    while (iterations < MAX_SEARCH_ITERATIONS) {
      iterations += 1;
      currentEvaluation = await this.getEvaluation(
        page,
        vehicleInfo,
        baseFilters,
        baseTransmissions,
        currentState,
        evaluationCache,
      );

      currentDelta = this.getCountDelta(currentEvaluation.count);
      currentState.score = currentDelta;
      this.logWeightedEvaluation(currentState, currentEvaluation.count);

      if (currentDelta < bestResult.delta) {
        bestResult = {
          state: currentState,
          evaluation: currentEvaluation,
          axis: 'current',
          delta: currentDelta,
          weightedScore: currentDelta * RADIUS_WEIGHT,
        };
      }

      if (
        currentEvaluation.count >= TARGET_COMP_MIN &&
        currentEvaluation.count <= TARGET_COMP_MAX
      ) {
        return {
          filters: currentEvaluation.filters,
          marketLookupData: currentEvaluation.marketLookupData,
        };
      }

      const candidates = await this.buildAxisCandidates(
        page,
        vehicleInfo,
        baseFilters,
        baseTransmissions,
        currentState,
        evaluationCache,
        initialRange, // Pass initial range for isActive=1 fallback
        hasTriedIsActive1, // Pass flag to prevent duplicate isActive=1 candidates
      );

      if (!candidates.length) {
        console.warn(
          `${FILTER_LOG_PREFIX}[Weighted] No further candidates available.`,
        );
        break;
      }

      candidates.sort((a, b) => a.weightedScore - b.weightedScore);
      const nextCandidate = candidates[0];

      console.log(
        `${FILTER_LOG_PREFIX}[Weighted] iteration: ${iterations} Moving axis=${nextCandidate.axis} ` +
        `count=${nextCandidate.evaluation.count} delta=${nextCandidate.delta}`,
      );

      if (
        nextCandidate.delta > bestResult.delta &&
        nextCandidate.evaluation.count > 0
      ) {
        console.log(
          `${FILTER_LOG_PREFIX}[Weighted] Candidate delta not better. Stopping search.`,
        );
        break;
      }

      if (nextCandidate.delta === 0) {
        return {
          filters: nextCandidate.evaluation.filters,
          marketLookupData: nextCandidate.evaluation.marketLookupData,
        };
      }

      currentState = nextCandidate.state;
      currentEvaluation = nextCandidate.evaluation;
      currentDelta = nextCandidate.delta;
      bestResult = nextCandidate;

      // Track if we've selected the isActive=1 candidate
      if (nextCandidate.axis === 'isActive=1') {
        hasTriedIsActive1 = true;
      }
    }

    console.log(
      `${FILTER_LOG_PREFIX}[Weighted] Returning closest match (count=${bestResult.evaluation.count}, ` +
      `delta=${bestResult.delta}).`,
    );
    return {
      filters: bestResult.evaluation.filters,
      marketLookupData: bestResult.evaluation.marketLookupData,
    };
  }

  private cloneFilters(filters: any) {
    return JSON.parse(JSON.stringify(filters ?? {}));
  }

  private normalizeNumber(value: any): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeOdometerMin(value: any): number | null {
    const parsed = this.normalizeNumber(value);
    if (parsed === null || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  private normalizeOdometerMax(value: any): number {
    const parsed = this.normalizeNumber(value);
    if (parsed === null || parsed <= 0) {
      return DEFAULT_ODOMETER_MAX;
    }
    return parsed;
  }

  private serializeState(state: FilterSearchState): string {
    const transmissionsKey = state.transmissions?.join(',') ?? 'none';
    return [
      state.radiusIdx,
      state.odometerMin ?? 'null',
      state.odometerMax ?? 'null',
      state.isActive,
      state.transmissionsMode,
      transmissionsKey,
    ].join('|');
  }

  private async evaluateState(
    page: Page,
    vehicleInfo: any,
    baseFilters: any,
    baseTransmissions: string[] | null,
    state: FilterSearchState,
  ) {
    const filtersSnapshot = this.buildFiltersFromState(
      baseFilters,
      baseTransmissions,
      state,
    );
    const marketLookupData = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/MarketData/GetFilterLookupData',
      'POST',
      { Authorization: `Bearer ${accessToken}` },
      {
        filters: filtersSnapshot,
        maxDigitalPriceLockType: 1,
        vehicleInfo,
      },
    );
    const count = marketLookupData.marketDaysSupplyResponse.matching;
    return { filters: filtersSnapshot, marketLookupData, count };
  }

  private async getEvaluation(
    page: Page,
    vehicleInfo: any,
    baseFilters: any,
    baseTransmissions: string[] | null,
    state: FilterSearchState,
    cache: Map<string, EvaluationResult>,
  ): Promise<EvaluationResult> {
    const key = this.serializeState(state);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const evaluation = await this.evaluateState(
      page,
      vehicleInfo,
      baseFilters,
      baseTransmissions,
      state,
    );
    cache.set(key, evaluation);
    return evaluation;
  }

  private buildFiltersFromState(
    baseFilters: any,
    baseTransmissions: string[] | null,
    state: FilterSearchState,
  ) {
    const snapshot = this.cloneFilters(baseFilters);
    snapshot.radiusInMiles = LOCATION_RADIUS_PRESET[state.radiusIdx];
    snapshot.odometerMin = this.normalizeOdometerMin(state.odometerMin ?? null);
    snapshot.odometerMax = this.normalizeOdometerMax(
      state.odometerMax ?? DEFAULT_ODOMETER_MAX,
    );
    snapshot.isActive = state.isActive;

    if (
      state.transmissionsMode === 'expanded' &&
      state.transmissions &&
      state.transmissions.length
    ) {
      snapshot.transmissions = [...state.transmissions];
    } else if (baseTransmissions && baseTransmissions.length) {
      snapshot.transmissions = [...baseTransmissions];
    } else {
      delete snapshot.transmissions;
    }

    return snapshot;
  }

  private cloneState(state: FilterSearchState): FilterSearchState {
    return {
      ...state,
      transmissions: state.transmissions ? [...state.transmissions] : null,
    };
  }

  private async buildAxisCandidates(
    page: Page,
    vehicleInfo: any,
    baseFilters: any,
    baseTransmissions: string[] | null,
    state: FilterSearchState,
    cache: Map<string, EvaluationResult>,
    initialRange?: { min: number | null; max: number | null },
    hasTriedIsActive1: boolean = false,
  ): Promise<CandidateEvaluation[]> {
    const candidates: CandidateEvaluation[] = [];
    const nextDepth = state.depth + 1;

    if (state.radiusIdx < LOCATION_RADIUS_PRESET.length - 1) {
      const radiusState = this.cloneState(state);
      radiusState.radiusIdx += 1;
      radiusState.cost += RADIUS_WEIGHT;
      radiusState.depth = nextDepth;
      const evaluation = await this.getEvaluation(
        page,
        vehicleInfo,
        baseFilters,
        baseTransmissions,
        radiusState,
        cache,
      );
      const delta = this.getCountDelta(evaluation.count);
      candidates.push({
        state: radiusState,
        evaluation,
        axis: 'radius+',
        delta,
        weightedScore: delta * RADIUS_WEIGHT,
      });
    }

    const expandedRange = this.expandOdometerRange(state);
    if (expandedRange) {
      const odometerState = this.cloneState(state);
      odometerState.odometerMin = expandedRange.min;
      odometerState.odometerMax = expandedRange.max;
      odometerState.cost += MILEAGE_WEIGHT;
      odometerState.depth = nextDepth;
      const evaluation = await this.getEvaluation(
        page,
        vehicleInfo,
        baseFilters,
        baseTransmissions,
        odometerState,
        cache,
      );
      const delta = this.getCountDelta(evaluation.count);
      candidates.push({
        state: odometerState,
        evaluation,
        axis: 'odometer+',
        delta,
        weightedScore: delta * MILEAGE_WEIGHT,
      });
    }

    // If we've exhausted radius and odometer axes, and isActive is still 0,
    // try isActive = 1 with initial filters (only once)
    const hasReachedMaxRadius =
      state.radiusIdx >= LOCATION_RADIUS_PRESET.length - 1;
    const hasReachedMaxOdometer = !expandedRange;
    const isStillActiveOnly = state.isActive === 0;

    if (
      hasReachedMaxRadius &&
      hasReachedMaxOdometer &&
      isStillActiveOnly &&
      !hasTriedIsActive1 &&
      initialRange
    ) {
      // Determine the max value - getNarrowOdometerRange always returns a number for max,
      // but getInitialOdometerRange can return null
      const maxValue =
        initialRange.max !== null && initialRange.max !== undefined
          ? initialRange.max
          : DEFAULT_ODOMETER_MAX;

      const activeState: FilterSearchState = {
        radiusIdx: 0, // Reset to initial radius
        odometerMin: initialRange.min, // Reset to initial odometer range
        odometerMax: maxValue,
        isActive: 1, // Try with all vehicles (including inactive)
        transmissionsMode: state.transmissionsMode,
        transmissions: state.transmissions ? [...state.transmissions] : null,
        cost: state.cost + 10, // Higher cost for isActive = 1 (less preferred)
        depth: nextDepth,
      };

      const evaluation = await this.getEvaluation(
        page,
        vehicleInfo,
        baseFilters,
        baseTransmissions,
        activeState,
        cache,
      );
      const delta = this.getCountDelta(evaluation.count);
      candidates.push({
        state: activeState,
        evaluation,
        axis: 'isActive=1',
        delta,
        weightedScore: delta * 10, // Higher weight penalty for isActive = 1
      });

      console.log(
        `${FILTER_LOG_PREFIX}[Weighted] Exhausted radius and odometer axes. ` +
        `Trying isActive=1 with initial filters.`,
      );
    }

    return candidates;
  }

  private transmissionListIncludes(
    list: string[] | null,
    value: string,
  ): boolean {
    if (!list || !list.length) {
      return false;
    }
    return list.includes(value);
  }

  private isBetterCandidate(
    current: CandidateEvaluation,
    best: CandidateEvaluation | null,
  ): boolean {
    if (!best) {
      return true;
    }
    if (current.delta === best.delta) {
      return current.state.cost < best.state.cost;
    }
    return current.delta < best.delta;
  }

  private logWeightedEvaluation(state: FilterSearchState, count: number) {
    const displayMin = this.normalizeOdometerMin(state.odometerMin ?? null);
    const displayMax = this.normalizeOdometerMax(
      state.odometerMax ?? DEFAULT_ODOMETER_MAX,
    );
    const delta = this.getCountDelta(count);
    console.log(
      `${FILTER_LOG_PREFIX}[Weighted] Eval radius=${LOCATION_RADIUS_PRESET[state.radiusIdx]
      } ` +
      `odometer=${displayMin ?? 'null'}-${displayMax} ` +
      `isActive=${state.isActive} transmissions=${state.transmissionsMode} ` +
      `cost=${state.cost.toFixed(2)} delta=${delta} count=${count}`,
    );
  }

  /**
   * Get the appropriate mileage step based on odometer max value
   * If odometer_max > 130000, use 15000, otherwise use 7500
   */
  private getMileageStep(odometerMax: number | null): number {
    if (odometerMax === null || odometerMax === undefined) {
      return MILEAGE_STEP; // Default to 7500 if max is not available
    }
    return odometerMax > MILEAGE_STEP_THRESHOLD
      ? MILEAGE_STEP_HIGH
      : MILEAGE_STEP;
  }

  private getNarrowOdometerRange(
    vehicleInfo: any,
    baseMin: any,
    baseMax: any,
  ): { min: number | null; max: number } {
    const targetOdometer =
      this.normalizeNumber(vehicleInfo?.odometer) ??
      this.normalizeNumber(baseMin) ??
      this.normalizeNumber(baseMax) ??
      DEFAULT_ODOMETER_MAX / 2;

    const baseMinValue = this.normalizeNumber(baseMin);
    const baseMaxValue = this.normalizeNumber(baseMax);
    const baseWidth =
      baseMinValue !== null && baseMaxValue !== null
        ? baseMaxValue - baseMinValue
        : null;

    // Determine mileage step based on target odometer (use as proxy for max)
    // We'll recalculate with actual max if needed
    const initialMileageStep = this.getMileageStep(targetOdometer);

    let minCandidate =
      baseWidth !== null && baseWidth <= initialMileageStep * 2
        ? baseMinValue
        : Math.max(targetOdometer - initialMileageStep, 0);
    let maxCandidate =
      baseWidth !== null && baseWidth <= initialMileageStep * 2
        ? baseMaxValue ?? targetOdometer + initialMileageStep
        : Math.min(targetOdometer + initialMileageStep, DEFAULT_ODOMETER_MAX);

    if (
      minCandidate !== null &&
      maxCandidate !== null &&
      maxCandidate <= minCandidate
    ) {
      maxCandidate = Math.min(
        minCandidate + initialMileageStep * 2,
        DEFAULT_ODOMETER_MAX,
      );
    }

    if (maxCandidate === null || maxCandidate <= 0) {
      maxCandidate = DEFAULT_ODOMETER_MAX;
    }

    // Recalculate mileage step based on actual max candidate
    const finalMileageStep = this.getMileageStep(maxCandidate);

    // If the step changed, recalculate with the correct step
    if (finalMileageStep !== initialMileageStep) {
      minCandidate = Math.max(targetOdometer - finalMileageStep, 0);
      maxCandidate = Math.min(
        targetOdometer + finalMileageStep,
        DEFAULT_ODOMETER_MAX,
      );
    }

    const normalizedMin = this.normalizeOdometerMin(minCandidate);
    const normalizedMax = this.normalizeOdometerMax(maxCandidate);

    return {
      min: normalizedMin,
      max: normalizedMax,
    };
  }

  private getInitialOdometerRange(
    vehicleInfo: any,
  ): { min: number | null; max: number | null } | null {
    const odometer = this.normalizeNumber(vehicleInfo?.odometer);
    if (!odometer || odometer <= 0) {
      return null;
    }

    // Determine mileage step based on odometer value
    const mileageStep = this.getMileageStep(odometer);

    const minCandidate =
      odometer - mileageStep <= 0 ? null : odometer - mileageStep;
    const maxCandidate =
      odometer + mileageStep >= MAX_ODOMETER_LIMIT
        ? null
        : odometer + mileageStep;

    return {
      min: this.normalizeOdometerMin(minCandidate),
      max:
        maxCandidate === null ? null : this.normalizeOdometerMax(maxCandidate),
    };
  }

  private expandOdometerRange(
    state: FilterSearchState,
  ): { min: number | null; max: number | null } | null {
    const currentMin = this.normalizeOdometerMin(state.odometerMin ?? null);
    const currentMax = this.normalizeOdometerMax(
      state.odometerMax ?? DEFAULT_ODOMETER_MAX,
    );

    if (currentMin === null && currentMax >= DEFAULT_ODOMETER_MAX) {
      return null;
    }

    // Determine mileage step based on current max value
    const mileageStep = this.getMileageStep(currentMax);

    const nextMin =
      currentMin === null ? null : Math.max(currentMin - mileageStep, 0);
    const nextMax =
      currentMax >= MAX_ODOMETER_LIMIT
        ? null
        : Math.min(currentMax + mileageStep, MAX_ODOMETER_LIMIT);

    if (nextMin === currentMin && nextMax === currentMax) {
      return null;
    }

    if (nextMin !== null && nextMax !== null && nextMin >= nextMax) {
      return null;
    }

    return {
      min: this.normalizeOdometerMin(nextMin),
      max: nextMax === null ? null : this.normalizeOdometerMax(nextMax),
    };
  }

  private getCountDelta(count: number): number {
    if (count >= TARGET_COMP_MIN && count <= TARGET_COMP_MAX) {
      return 0;
    }
    if (count < TARGET_COMP_MIN) {
      return TARGET_COMP_MIN - count;
    }
    return count - TARGET_COMP_MAX;
  }

  /**
   * Processes a question and generates an answer based on vehicle data.
   * This is a unit function that can be tested independently.
   *
   * @param question - The question object from DC API
   * @param vehicle - Vehicle information
   * @param existingAnswer - Existing answer for this question book (if any)
   * @returns Object containing the answer and optional transmission selection metadata
   * @throws UncoveredCaseError if the question type is not handled
   */
  static processQuestionAnswer(
    question: IQuestion,
    vehicle: IVehicle,
    existingAnswer?: IAnswer,
  ): {
    answer: IAnswer;
    autoSelection?: {
      key: string;
      vin: string;
      selectedOption: { id: string; name: string };
      availableOptions: Array<{ id: string; name: string }>;
      vehicleTrim?: string;
    };
  } {
    if (question.type === 'select') {
      if (question.key === 'trim') {
        const bestMatch = findBestMatch(vehicle.trim, question.items);

        console.log(
          `Selecting best matching trim: "${bestMatch.name}" for vehicle trim "${vehicle.trim}"`,
        );

        const answer: IAnswer = existingAnswer
          ? { ...existingAnswer, modelId: bestMatch.id }
          : {
            book: question.book,
            addDeduct: [],
            modelId: bestMatch.id,
            isBlank: null,
          };

        return { answer };
      } else if (
        question.key === 'transmission' &&
        (!vehicle.transmission || vehicle.transmission.trim() === '')
      ) {
        // Vehicle doesn't have transmission info, so select randomly
        const randomIndex = Math.floor(Math.random() * question.items.length);
        const selectedTransmission = question.items[randomIndex];
        const selectedTransmissionId = selectedTransmission.id;

        console.log(
          `⚠️  Vehicle without transmission info - randomly selecting transmission: "${selectedTransmission.name}" for VIN ${vehicle.vin}`,
        );

        const answer: IAnswer = existingAnswer
          ? { ...existingAnswer, modelId: selectedTransmission.id }
          : {
            book: question.book,
            addDeduct: question.items
              .map((item: any) => ({
                action: item.id === selectedTransmissionId ? 0 : 1,
                code: item.id,
              }))
              .sort((a, b) => a.code.localeCompare(b.code)),
            isBlank: null,
          };

        // Store metadata about auto selection to notify caller
        const availableOptions = question.items.map((item: any) => ({
          id: item.id,
          name: item.name,
        }));

        const autoSelection = {
          key: question.key,
          vin: vehicle.vin,
          selectedOption: {
            id: selectedTransmission.id,
            name: selectedTransmission.name,
          },
          availableOptions,
          vehicleTrim: vehicle.trim,
        };

        return { answer, autoSelection };
      } else {
        // Other cases, we will pick randomly
        const randomIndex = Math.floor(Math.random() * question.items.length);
        const selectedTransmission = question.items[randomIndex];
        const selectedTransmissionId = selectedTransmission.id;

        console.log(
          `⚠️  Vehicle without transmission info - randomly selecting transmission: "${selectedTransmission.name}" for VIN ${vehicle.vin}`,
        );

        const answer: IAnswer = existingAnswer
          ? { ...existingAnswer, modelId: selectedTransmission.id }
          : {
            book: question.book,
            addDeduct: question.items
              .map((item: any) => ({
                action: item.id === selectedTransmissionId ? 0 : 1,
                code: item.id,
              }))
              .sort((a, b) => a.code.localeCompare(b.code)),
            isBlank: null,
          };

        // Store metadata about auto selection to notify caller
        const availableOptions = question.items.map((item: any) => ({
          id: item.id,
          name: item.name,
        }));

        const autoSelection = {
          key: question.key,
          vin: vehicle.vin,
          selectedOption: {
            id: selectedTransmission.id,
            name: selectedTransmission.name,
          },
          availableOptions,
          vehicleTrim: vehicle.trim,
        };

        return { answer, autoSelection };
      }
    } else if (question.type === 'checkbox') {
      // select all options
      const existingAddDeduct = existingAnswer?.addDeduct || [];
      const newItems = question.items.filter(
        (el: any) =>
          !existingAddDeduct.some(
            (existingEl: any) => existingEl.code === el.id,
          ),
      );
      const newAddDeduct = newItems.map((el: any) => ({
        action: 0,
        code: el.id,
      }));

      const answer: IAnswer = existingAnswer
        ? {
          ...existingAnswer,
          addDeduct: [...existingAddDeduct, ...newAddDeduct].sort((a, b) =>
            a.code.localeCompare(b.code),
          ),
        }
        : {
          book: question.book,
          addDeduct: question.items
            .map((el: any) => ({
              action: 0,
              code: el.id,
            }))
            .sort((a, b) => a.code.localeCompare(b.code)),
          isBlank: null,
        };

      return { answer };
    } else {
      // Uncovered case - just throw error, handling will be done outside this module
      const error = new UncoveredCaseError(vehicle.vin, question, vehicle.trim);
      console.error(`\n🚨 Uncovered case detected for VIN ${vehicle.vin}:`);
      console.error('Question:', JSON.stringify(question, null, 2));
      console.error('Vehicle Trim:', vehicle.trim);
      throw error;
    }
  }
  async completeVehicleBuild(
    page: Page,
    vehicle: IVehicle,
  ): Promise<{
    vehicleBuilds: any;
    cityMpg: number;
    vehicleWeight: number;
    highwayMpg: number;
    grossVehicleWeight: number;
    autoSelection?: {
      key: string;
      vin: string;
      selectedOption: { id: string; name: string };
      availableOptions: Array<{ id: string; name: string }>;
      vehicleTrim?: string;
      inventoryId?: string;
    };
  }> {
    const answers: IAnswer[] = [];
    let autoSelection:
      | {
        key: string;
        vin: string;
        selectedOption: { id: string; name: string };
        availableOptions: Array<{ id: string; name: string }>;
        vehicleTrim?: string;
        inventoryId?: string;
      }
      | undefined = undefined;

    do {
      const {
        questions,
        vehicleBuilds,
        cityMpg,
        vehicleWeight,
        highwayMpg,
        grossVehicleWeight,
      } = await this.getBuild(page, vehicle.vin, accessToken!, answers);
      if (!questions.length) {
        return {
          vehicleBuilds,
          cityMpg,
          vehicleWeight,
          highwayMpg,
          grossVehicleWeight,
          autoSelection,
        };
      }
      questions.forEach(question => {
        const exist = answers.find(answer => answer.book === question.book);

        const result = DCEngine.processQuestionAnswer(question, vehicle, exist);

        // Update or add answer
        if (exist) {
          Object.assign(exist, result.answer);
        } else {
          answers.push(result.answer);
        }

        // Store auto selection metadata if present
        if (result.autoSelection) {
          autoSelection = result.autoSelection;
        }
      });
      // console.log('QUESTIONS', JSON.stringify(questions, null, 2));
      // console.log('ANSWERS', JSON.stringify(answers, null, 2));
    } while (true);
  }
  async getBuild(
    page: Page,
    vin: string,
    token: string,
    answers: Array<IAnswer>,
  ): Promise<{
    questions: IQuestion[];
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
      question,
      highwayMpg,
      cityMpg,
      vehicleWeight,
      vehicleBuilds,
      grossVehicleWeight,
    } = resp;
    // console.log(JSON.stringify(question, null, 2));
    // if (!vehicleBuilds) throw new Error('Invalid VIN');
    const questionObj: IQuestion[] =
      question && question.options.length > 0
        ? question.options.map((option: any) => {
          let key = option.subTitle?.toLowerCase() || '';
          if (question.title?.toLowerCase() === 'please select trim.') {
            key = 'trim';
          }
          return {
            book: question.book,
            key,
            items: option.items.map((el: any) => ({
              id: el.id,
              name: el.displayName,
            })),
            type: option.optionType === 1 ? 'checkbox' : 'select',
          } as IQuestion;
        })
        : [];

    return {
      questions: questionObj,
      vehicleBuilds,
      highwayMpg,
      cityMpg,
      vehicleWeight,
      grossVehicleWeight,
    };
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
    // console.log(data);
    const {
      id,
      companyId,
      marketDataRequest: { filters, vehicleInfo },
    } = data;
    return { filters, vehicleInfo, id, companyId };
  }
  async getMarketPrice(
    page: Page,
    filters: any,
    vehicleInfo: any,
    vin?: string,
  ) {
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
  async close(): Promise<void> {
    return this.window.disconnect();
  }
}
