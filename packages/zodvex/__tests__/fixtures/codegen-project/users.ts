import { z } from 'zod'
import { attachMeta } from '../../../src/meta'

const get = { _isRegistered: true }
attachMeta(get, {
  type: 'function',
  zodArgs: z.object({ id: z.string() }),
  zodReturns: z.object({ name: z.string() })
})

const list = { _isRegistered: true }
attachMeta(list, {
  type: 'function',
  zodArgs: z.object({}),
  zodReturns: z.array(z.object({ name: z.string() }))
})

// A plain export without metadata (should be skipped)
const helper = () => {
  /* no-op — tests that exports without metadata are skipped */
}

export { get, list, helper }
