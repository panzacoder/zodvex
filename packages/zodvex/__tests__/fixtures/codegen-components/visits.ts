import { z } from 'zod'
import { attachMeta } from '../../../src/meta'
import { components } from './_generated/api'

// Module-scope component instantiation — this is the pattern that fails
// without the discovery stub. In real projects this would be something like:
//   const localDTA = new LocalDTA(components.localDTA)
const componentRef = new (components as any).localDTA.lib.LocalDTA(components.localDTA)

const dropIn = { _isRegistered: true, _componentRef: componentRef }
attachMeta(dropIn, {
  type: 'function',
  zodArgs: z.object({ visitorId: z.string() }),
  zodReturns: undefined
})

export { dropIn }
