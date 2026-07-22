import { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// import { browserInitialized } from "../decorators/window";
const stealth = StealthPlugin();
puppeteer.use(stealth);
stealth.enabledEvasions.delete('iframe.contentWindow');

export class Window {
  headless: boolean;
  browser: Browser | null;
  page: Page | null;
  constructor(headless = false) {
    this.headless = headless;
    this.page = null;
    this.browser = null;
  }
  async connectRemote(port: number) {
    const browserURL = `http://127.0.0.1:${port}`;
    this.browser = await puppeteer.connect({ browserURL });
    const pages = await this.browser.pages();
    this.page = pages[0];
    return this.page;
  }

  async disconnect() {
    if (this.browser === null) return;
    this.browser.disconnect();
  }
  async getPage(index: number) {
    if (this.browser === null) return;
    const pages = await this.browser.pages();
    return pages[index];
  }
  async navigate(path: string) {
    if (this.page === null) return;
    await this.page.goto(path, { waitUntil: 'networkidle2' });
  }
  async input(selector: string, text: string, delay: number = 0) {
    if (this.page === null) return;
    await this.page.waitForSelector(selector);
    await this.page.type(selector, text, { delay: delay });
  }
}
export async function sendAPIRequest(
  page: Page,
  url: string,
  method: 'GET' | 'POST',
  headers: Record<string, any> = {},
  body?: any,
) {
  const result = await page.evaluate(
    (url, method, body, headers) => {
      // This function runs in the browser context, so async/await cannot be used here
      return fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: method === 'POST' ? JSON.stringify(body) : null,
      })
        .then((response: any) => response.json())
        .catch((error: any) => {
          console.error('Fetch error:', error);
          return null; // Return null in case of error
        });
    },
    url,
    method,
    body,
    headers,
  );
  return result;
}

export async function sendFormRequest(
  page: Page,
  url: string,
  method: 'GET' | 'POST',
  headers: Record<string, any> = {},
  body: Record<string, any>,
) {
  const result = await page.evaluate(
    (url, method, body, headers) => {
      const formData = new URLSearchParams();
      Object.keys(body).forEach(key => formData.append(key, body[key]));
      // This function runs in the browser context, so async/await cannot be used here
      return fetch(url, {
        method: method,
        headers: {
          ...headers,
        },
        body: method === 'POST' ? formData.toString() : null,
      })
        .then((response: any) => {
          return {
            status: response.status,
            redirected: response.redirected,
            url: response.url,
          };
        })
        .catch((error: any) => {
          console.error('Fetch error:', error);
          return null; // Return null in case of error
        });
    },
    url,
    method,
    body,
    headers,
  );
  return result;
}
