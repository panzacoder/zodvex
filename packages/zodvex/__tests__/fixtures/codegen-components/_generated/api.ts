// Simulates a real Convex _generated/api.ts that throws outside the Convex runtime.
// In real projects this file accesses componentDefinitionPath which is only available
// in the Convex runtime, causing discovery to fail for any file that imports it.
throw new Error(
  'Component definition does not have the required componentDefinitionPath property. ' +
    'This code only works in Convex runtime.'
)

export const api = {}
export const internal = {}
export const components = {} as any
