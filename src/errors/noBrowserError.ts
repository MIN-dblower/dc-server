export class NoBrowserError extends Error {
  constructor() {
    super('Browser is not found. Please open the browser.');
    this.name = 'NoBrowserError';
  }
}
