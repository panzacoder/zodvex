import { z } from 'zod'
import { attachMeta } from '../../../../src/meta'

const summary = { _isRegistered: true }
attachMeta(summary, {
  type: 'function',
  zodArgs: z.object({}),
  zodReturns: z.object({ total: z.number() })
})

export { summary }
