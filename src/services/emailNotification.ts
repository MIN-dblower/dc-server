/**
 * Email Notification Service Interface
 * 
 * This interface defines the contract for email notification functionality.
 * Implementation will be added later.
 */

export interface EmailNotificationData {
  to: string | string[];
  subject: string;
  body: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

export interface TransmissionSelectionNotificationData {
  vin: string;
  selectedTransmission: {
    id: string;
    name: string;
  };
  availableOptions: Array<{
    id: string;
    name: string;
  }>;
  auctionType: 'Adesa' | 'Edge Pipeline';
}

/**
 * Email notification service interface
 * Implementation will be provided later
 */
export interface IEmailNotificationService {
  /**
   * Send a generic email notification
   */
  sendEmail(data: EmailNotificationData): Promise<void>;

  /**
   * Send notification about transmission selection for Edge Pipeline vehicles
   */
  sendTransmissionSelectionNotification(
    data: TransmissionSelectionNotificationData,
  ): Promise<void>;
}

/**
 * Placeholder email notification service
 * This will be implemented later
 */
class EmailNotificationService implements IEmailNotificationService {
  async sendEmail(data: EmailNotificationData): Promise<void> {
    // TODO: Implement email sending logic
    console.log('📧 Email notification (not implemented yet):', {
      to: data.to,
      subject: data.subject,
    });
  }

  async sendTransmissionSelectionNotification(
    data: TransmissionSelectionNotificationData,
  ): Promise<void> {
    const subject = `Transmission Selection Required - VIN: ${data.vin}`;
    const body = `
A transmission selection was made for an Edge Pipeline vehicle:

VIN: ${data.vin}
Auction Type: ${data.auctionType}
Selected Transmission: ${data.selectedTransmission.name} (ID: ${data.selectedTransmission.id})

Available Options:
${data.availableOptions.map(opt => `  - ${opt.name} (ID: ${opt.id})`).join('\n')}

Note: This selection was made randomly as Edge Pipeline vehicles do not have transmission information.
    `.trim();

    await this.sendEmail({
      to: process.env.EMAIL_NOTIFICATION_RECIPIENTS?.split(',') || [],
      subject,
      body,
    });
  }
}

let emailService: EmailNotificationService | null = null;

/**
 * Get the email notification service instance
 */
export function getEmailNotificationService(): IEmailNotificationService {
  if (!emailService) {
    emailService = new EmailNotificationService();
  }
  return emailService;
}

