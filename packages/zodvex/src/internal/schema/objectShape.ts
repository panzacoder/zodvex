import { $ZodObject } from '../zod-core'

export function getObjectShape(obj: any): Record<string, any> {
  if (obj instanceof $ZodObject) {
    return obj._zod.def.shape as Record<string, any>
  }
  if (obj && typeof obj === 'object' && typeof obj.shape === 'object') {
    return obj.shape as Record<string, any>
  }
  return {}
}
