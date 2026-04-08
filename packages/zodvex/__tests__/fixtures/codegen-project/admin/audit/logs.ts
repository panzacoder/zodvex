import { z } from 'zod'
import { attachMeta } from '../../../../../src/internal/meta'

const list = { _isRegistered: true }
attachMeta(list, {
  type: 'function',
  zodArgs: z.object({}),
  zodReturns: z.array(z.string())
})

export { list }
