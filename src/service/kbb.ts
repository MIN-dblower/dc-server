import { Window } from '../class/window';
import { delay } from '../lib/time';

export enum Transmission {
  automatic = 0,
  manual,
}
export class KBB {
  window: Window;
  vin: string;
  transmission: Transmission;
  milage: number;
  zipcode: string;
  constructor(
    vin: string,
    transmission: Transmission,
    milage: number,
    zipcode: string,
  ) {
    this.window = new Window();
    this.vin = vin;
    this.transmission = transmission;
    this.milage = milage;
    this.zipcode = zipcode;
  }
  async getData() {
    const page = await this.window.connect();
    await page.goto('https://www.kbb.com/whats-my-car-worth', {
      waitUntil: 'networkidle2',
    });
    console.log('Page loaded');
    // Input VIN
    await page.waitForSelector('input[data-lean-auto="vinInput"');
    // const vinInputHandler = await page.$('input[data-lean-auto="vinInput"');
    await page.type('input[data-lean-auto="vinInput"', this.vin, { delay: 50 });

    const goBtnHandler = await page.$('button[data-lean-auto="vinSubmitBtn"]');
    await Promise.all([
      page.waitForSelector('button[data-lean-auto="vinSubmitBtn"]'),
      goBtnHandler?.click(),
      page.waitForNavigation(),
    ]);

    console.log('Found Vehicle');
    await page.waitForSelector('#transmission');
    await page.select('#transmission select', '8589866');

    await page.waitForSelector('div[data-testid="mileageInput"] input', {
      visible: true,
    });

    await page.type(
      'div[data-testid="mileageInput"] input',
      this.milage.toString(),
      { delay: 50 },
    );
    await page.waitForSelector('div[data-testid="zipcodeInput"] input', {
      visible: true,
    });

    await page.type('div[data-testid="zipcodeInput"] input', this.zipcode, {
      delay: 50,
    });
    await delay(1000);

    await page.waitForSelector('button[data-cy="vinLpNext"]', {
      visible: true,
    });
    await Promise.all([
      page.click('button[data-cy="vinLpNext"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    // 3. Fill out in the check boxes
    // 3-1. 2 or more keys or ...
    const anchor = await page.$(
      'input-rounded-button[data-testid="twoKeysQuestionButtonqp/79-false"]',
    );
    console.log(anchor);
    await anchor?.press('Enter');
    return;
    await page.waitForSelector(
      'input-rounded-button[data-testid="twoKeysQuestionButtonqp/79-false"]',
      {
        visible: true, // Waits until the button is visible in the DOM
      },
    );
    await page.click('[data-testid="twoKeysQuestionButtonqp/79-false"]');
    await delay(500);

    // 3-2. Has your v had any modifications? ==> NO
    await page.waitForSelector(
      '[data-testid="vehicleModificationsQuestionButtontoggleQuestionModifications1-false"]',
      {
        visible: true, // Ensure the second button is also visible
      },
    );
    await page.click(
      '[data-testid="vehicleModificationsQuestionButtontoggleQuestionModifications1-false"]',
    );

    // Check trading my car option then
    await page.waitForSelector('#subintentOptionTrade');
    await page.click('#subintentOptionTrade');

    await delay(500);
    // Click the next button
    await page.click('[data-lean-auto="optionsNextButton"]');
  }
}
