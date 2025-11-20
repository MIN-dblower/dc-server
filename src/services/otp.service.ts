export async function fetchOtpWithBackoff(
  url: string,
  maxRetries = 5,
  initialDelay = 1000,
): Promise<string | null> {
  let attempt = 0;
  let delay = initialDelay;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      // Assuming the OTP is in a property named 'otp' and can be null
      if (data.otp) {
        console.log(`OTP code is ${data.otp}`);
        return data.otp as string;
      } else {
        console.log(`OTP is null or empty, retrying in ${delay}ms...`);
      }
    } catch (err) {
      console.error(`Fetch attempt ${attempt + 1} failed:`, err);
    }

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, delay));
    attempt++;
    delay *= 2; // exponential backoff
  }

  console.warn('Max retries reached, OTP not fetched.');
  return null;
}
