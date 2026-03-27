import type { ClientIntegration } from '../config'

export const mantineIntegration: ClientIntegration = {
  name: 'mantine',
  peerDependency: '@mantine/form',

  generateImports: () =>
    "import { mantineResolver as _mantineResolver } from 'zodvex/form/mantine'",

  generateExports: () =>
    'export const mantineResolver = (ref) => _mantineResolver(zodvexRegistry, ref)',

  generateDtsImports: () => "import type { FunctionReference } from 'convex/server'",

  generateDtsExports: () =>
    'export declare const mantineResolver: (ref: FunctionReference<any, any, any, any>) => (values: Record<string, unknown>) => Record<string, string>'
}
