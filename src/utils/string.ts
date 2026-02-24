export function toTitleCase(input: string): string {
    if (!input) return '';
    // Normalize whitespace, then capitalize first alphanumeric character
    return input
      .trim()
      .toLowerCase()
      .replace(/^\s+|\s+$/g, '') // trim again (redundant with trim, keeps safe)
      .replace(/(^|[\s-_]+)(\w)/g, (_, _p1, c) => c.toUpperCase());
  }