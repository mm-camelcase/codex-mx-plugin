import type { KeyDefinition, KeypadTarget } from '../domain/contracts.ts';
/** The hardware adapter consumes the same keys as the HTML renderer. */
export class LogitechKeypadTarget implements KeypadTarget {
  async render(_keys: KeyDefinition[]) { throw new Error('Hardware integration is not implemented or verified.'); }
}
