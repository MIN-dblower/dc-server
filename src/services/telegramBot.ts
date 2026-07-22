/**
 * Telegram Bot Service for Alerts
 *
 * Sends alerts via Telegram bot for system events, failures, and blocked VINs.
 * Uses no-polling mode (webhook/polling disabled) for direct API calls.
 *
 * TELEGRAM_CHAT_ID should point at a channel (e.g. -100XXXXXXXXXX or
 * @channel_username) with the bot added as an admin, not a single user's DM
 * — see docs/SETUP.md.
 */

import TelegramBot from 'node-telegram-bot-api';

class TelegramAlertService {
  private bot: TelegramBot | null = null;
  private chatId: string | null = null;
  private enabled: boolean = false;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (token && chatId) {
      try {
        // Use no-polling mode - we'll only send messages, not receive
        this.bot = new TelegramBot(token, { polling: false });
        this.chatId = chatId;
        this.enabled = true;
        console.log('✅ Telegram bot initialized (no-polling mode)');
      } catch (error) {
        console.error('❌ Failed to initialize Telegram bot:', error);
        this.enabled = false;
      }
    } else {
      console.warn(
        '⚠️  Telegram bot not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env',
      );
      this.enabled = false;
    }
  }

  /**
   * Send a message to Telegram
   */
  async sendMessage(message: string): Promise<void> {
    if (!this.enabled || !this.bot || !this.chatId) {
      console.log('📱 Telegram alert (not sent - bot disabled):', message.substring(0, 100));
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
      });
    } catch (error) {
      console.error('❌ Failed to send Telegram message:', error);
      throw error;
    }
  }

}

// Singleton instance
let telegramService: TelegramAlertService | null = null;

/**
 * Get the Telegram alert service instance
 */
export function getTelegramService(): TelegramAlertService {
  if (!telegramService) {
    telegramService = new TelegramAlertService();
  }
  return telegramService;
}

