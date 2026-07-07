// Unresolvable import: discovery must fail loudly, not skip this module.
import { missing } from './does-not-exist'

export const value = missing
