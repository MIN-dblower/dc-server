import { Page } from "puppeteer";
import { DCEngine } from "./dcengine";
import { LoginError } from "errors/loginError";

// Login retry configuration
const MAX_LOGIN_RETRIES = 3;
const LOGIN_RETRY_DELAY_MS = 2000; // 2 seconds between retries

/**
 * Attempts to login with retry logic
 * @throws LoginError if all retry attempts fail
 */
export async function attemptLoginWithRetry(
    dcEngine: DCEngine,
    page: Page,
    maxAttempts: number = MAX_LOGIN_RETRIES,
): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`🔄 Login attempt ${attempt}/${maxAttempts}`);

            await dcEngine.forceLogin(page);

            // Try to get token after login
            const token = await dcEngine.getToken(page);

            if (token) {
                console.log(`✅ Login successful on attempt ${attempt}`);
                return token;
            } else {
                throw new Error('Failed to retrieve token after login');
            }
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.error(`❌ Login attempt ${attempt} failed:`, lastError.message);

            if (attempt < maxAttempts) {
                console.log(`⏳ Waiting ${LOGIN_RETRY_DELAY_MS}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, LOGIN_RETRY_DELAY_MS));
            }
        }
    }

    // All attempts failed - throw LoginError
    throw new LoginError(maxAttempts, maxAttempts);
}
