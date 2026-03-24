import { registerBuiltinIntegration } from '../config'
import { mantineIntegration } from './mantine'

/** Register all built-in integration plugins. */
export function registerBuiltinIntegrations(): void {
  registerBuiltinIntegration('mantine', () => mantineIntegration)
}
