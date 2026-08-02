export class DebugError extends Error {
  public readonly source: string;

  constructor(message: string) {
    super(message);
    this.name = 'DebugError';
    // stackLines[0] = "DebugError: ..."
    // stackLines[1] = "    at new DebugError (...)"
    // stackLines[2] = the actual call site
    const callerFrame = this.stack?.split('\n')[2]?.trim() ?? 'unknown';
    this.source = callerFrame;
  }
}
