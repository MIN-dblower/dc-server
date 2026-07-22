/**
 * Custom error for when DC login hits an MFA challenge
 * MFA must be completed manually - login should not be retried automatically
 */

export class MfaRequiredError extends Error {
  constructor() {
    super('DealerCenter login requires MFA verification');
    this.name = 'MfaRequiredError';
  }
}
