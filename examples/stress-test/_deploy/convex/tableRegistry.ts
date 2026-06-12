import { zx } from 'zodvex'

const KEY = Symbol.for('zodvex.spike.tableRegistry')
const models: Map<string, any> = ((globalThis as any)[KEY] ??= new Map())

export function __registerModel(table: string, model: any): void {
  models.set(table, model)
}

const built: Map<string, any> = new Map()

export function __tableMapView(): Record<string, any> {
  return new Proxy(
    {},
    {
      get(_t, name) {
        if (typeof name !== 'string') return undefined
        if (built.has(name)) return built.get(name)
        const m = models.get(name)
        if (!m) return undefined
        const schemas = { doc: zx.doc(m), insert: zx.base(m) }
        built.set(name, schemas)
        return schemas
      },
      has(_t, name) {
        return typeof name === 'string' && models.has(name)
      },
      ownKeys() {
        return [...models.keys()]
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true }
      },
    },
  )
}
