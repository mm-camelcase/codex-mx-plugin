import type { CodexNavigator } from '../domain/contracts.ts';
export class UnsupportedNavigator implements CodexNavigator {
  supported = false;
  async openThread(_threadId: string) { throw new Error('Desktop thread navigation has not been verified.'); }
  async focusCodex() { throw new Error('Desktop focus is not implemented in this read-only prototype.'); }
}
