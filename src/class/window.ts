import { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
// import { browserInitialized } from "../decorators/window";
const stealth = StealthPlugin();
puppeteer.use(stealth);
stealth.enabledEvasions.delete("iframe.contentWindow");

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
        this.browser = await puppeteer.connect({ browserURL })
        const pages = await this.browser.pages();
        this.page = pages[0];
    }


    async disconnect() {
        if (this.browser === null) return;
        this.browser.disconnect();
    }
    async getPage(index: number) {
        if (this.browser === null) return;
        const pages = await this.browser.pages();
        return pages[index]
    }
    async connect() {
        const options = {
            defaultViewport: null,
            args: [
                // "--start-maximized",
                '--proxy-server=173.208.239.42:17093'
            ],
            headless: this.headless,
            devtools: false
        };
        if (process.platform == "linux") options.args.push("--no-sandbox");
        this.browser = await puppeteer.launch(options);
        this.browser.on("disconnected", async () => {
            console.log("BROWSER CRASH");
            if (this.browser && this.browser.process() != null) this.browser.process().kill("SIGINT");
        });
        // const pages = await this.browser.pages();
        // this.page = pages[0];
        this.page = await this.browser.newPage();
        await this.page.authenticate({
            username: '14af3537cb24d',
            password: 'd8213aad9a'
        })
        // await this.page.goto("chrome://settings/");
        await this.page.evaluate(() => {
            document.body.style.zoom = '0.5';
        });
        // await this.page.setRequestInterception(true);
        // this.page.on('request', (request) => {
        //     // Use the resourceType method to determine the type of the request
        //     if (request.resourceType() === 'image' || request.resourceType() === 'stylesheet') {
        //         // Abort requests for images or stylesheets
        //         request.abort();
        //     } else {
        //         // Continue with all other requests
        //         request.continue();
        //     }
        // });
        await this.page.setDefaultNavigationTimeout(100000);
        return this.page;
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