import { Page } from 'puppeteer';
import { sendAPIRequest, Window } from '../class/window';
import { delay } from '../lib/time';
import * as cheerio from 'cheerio';

enum Status {
  NOT_AUTHORIZED = 'not_authorized',
  DUPLICATE_VIN = 'duplicate_vin',
  COMPLETE_PROCESS = 'complete_process',
}
export class DataCenterScraper {
  vin: string;
  window: Window;
  screenshotDir: string;
  constructor(vin: string) {
    this.vin = vin;
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
  async getData(page: Page) {
    await this.gotoAppraisalPage(page);
    await delay(1000);
    const status = await this.checkModal(page);
    console.log(status);
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
        vin: this.vin,
        companyId: null,
      },
    );
    console.log(duplicateData);
    const buildQuestionData = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetVehicleBuilds',
      'POST',
      { Authorization: `Bearer ${tokens.userAccessToken}` },
      {
        method: 2,
        requestedBook: [1, 2, 3, 4],
        defaultBookServiceType: 1,
        input: {
          vin: 'WMWLV7C00L2L81812',
          year: null,
          make: null,
          modelName: null,
          trim: null,
          book: 1,
          additionalModelInfos: [],
        },
      },
    );
    const { question } = buildQuestionData;
    // console.log(JSON.stringify(buildQuestionData, null, 2));
    let vehicleBuilds;
    if (question) {
      const buildData = await sendAPIRequest(
        page,
        'https://app.dealercenter.net/api-gateway/inventory/BookService/GetVehicleBuilds',
        'POST',
        { Authorization: `Bearer ${tokens.userAccessToken}` },
        {
          method: 2,
          requestedBook: [1, 2, 3, 4],
          defaultBookServiceType: 1,
          input: {
            vin: this.vin,
            year: null,
            make: null,
            modelName: null,
            trim: null,
            book: 1,
            additionalModelInfos: [],
            answers: [
              {
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
              },
            ],
          },
        },
      );
      vehicleBuilds = buildData.vehicleBuilds;
    } else {
      vehicleBuilds = buildQuestionData.vehicleBuilds;
    }

    // return '';
    const vehicleMeta = {
      make: vehicleBuilds[0].make,
      modelName: vehicleBuilds[0].model,
      trim: vehicleBuilds[0].trim,
      year: vehicleBuilds[0].year,
    };
    const valueData = await sendAPIRequest(
      page,
      'https://app.dealercenter.net/api-gateway/inventory/BookService/GetValuationValues',
      'POST',
      { Authorization: `Bearer ${tokens.userAccessToken}` },
      {
        method: 1,
        odometer: 232,
        vehicleType: 1,
        vin: this.vin,
        isTitleBrandCommercial: false,
        hasExistingNadaBooked: false,
        hasExistingBBBooked: false,
        year: vehicleMeta.year,
        make: vehicleMeta.make,
        modelName: vehicleMeta.modelName,
        trim: vehicleMeta.trim,
        vehicleBuilds: vehicleBuilds.map((build: any, index: number) => ({
          region: index ? 'IL' : '62298',
          color: '',
          bookPeriod: null,
          equipmentIds: build.vehicleEquipments
            .filter((el: any) => el.checked)
            .map((el: any) => el.code),
          grade: 0,
          bookType: index + 1,
          modelId: build.modelIdentifier,
          vehicleBuildDTO: build,
        })),
      },
    );
    console.log(valueData);
    return '';
    // Input VIN
    await page.waitForSelector('kendo-textbox[formcontrolname="vin"] input');
    await page.type('kendo-textbox[formcontrolname="vin"] input', this.vin, {
      delay: 40,
    });

    // Click load button
    await page.waitForSelector('div.vehicle-info-section button');
    await Promise.all([
      page.click('div.vehicle-info-section button'),
      page.waitFor(500),
    ]);

    await delay(1000);
    // Check if a modal poped up

    const isModal = (await page.$$('kendo-dialog')).length;
    if (isModal) {
      // Get the title of modal
      const titleText = await page.evaluate(() => {
        const div = document.querySelector(
          'kendo-dialog kendo-dialog-titlebar span',
        );
        return div ? div.textContent?.trim() : null;
      });
      if (
        titleText?.toLowerCase() ===
        'Complete Vehicle Build Information'.toLowerCase()
      ) {
        const nextButton = await page.$(
          'kendo-dialog kendo-dialog-actions button',
        );
        await Promise.all([nextButton?.click(), page.waitFor(500)]);
      } else if (titleText?.toLowerCase() === 'Duplicate Vin'.toLowerCase()) {
        console.log('The span exists and its text is "Duplicate Vin".');
        const aLink = await page.evaluate(() => {
          // Select the anchor element within the specified div
          const anchor = document.querySelector(
            'div.k-window-content.k-dialog-content a',
          );
          return anchor ? anchor.getAttribute('href') : null; // Return href if anchor exists
        });

        aLink &&
          (await Promise.all([
            page.goto(`https://app.dealercenter.net/apps/shell/${aLink}`),
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
          ]));
      }
    }

    // Get Info
    const content = await page.content();
    return content;
  }

  anaylzeContent(content: string) {
    const $ = cheerio.load(content);
    // find anchor

    const contentDivs = $('div.valuation-item');
    console.log(contentDivs.text());
    const result: Record<string, any[]> = {};
    // console.log(contentDivs.length);
    $('div.valuation-item').each((index, div) => {
      const provider = $(div)
        .children()
        .eq(1)
        .find('div.book-label')
        .text()
        .trim();
      const data: any[] = [];
      $(div)
        .children()
        .eq(2)
        .children('div')
        .children()
        .each((i, child) => {
          const key = $(child)
            .find('div.field-label')
            .text()
            .trim();
          const val = $(child)
            .find('div.value-label')
            .text()
            .trim();
          key.length && data.push({ [key]: val });
        });
      result[provider] = data;
    });
    return result;
  }
}
