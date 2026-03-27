import fs from 'node:fs'
import path from 'node:path'

/**
 * A client integration plugin that contributes imports and exports
 * to the generated `_zodvex/client.*` files.
 */
export interface ClientIntegration {
  /** Short name used in the config `integrations` array (e.g. 'mantine'). */
  name: string
  /** The npm package that must be present for autoDetect (e.g. '@mantine/form'). */
  peerDependency: string
  /** Returns JS import statement(s) for the generated client.js. */
  generateImports: () => string
  /** Returns JS export statement(s) for the generated client.js. */
  generateExports: () => string
  /** Returns DTS import statement(s) for the generated client.d.ts. */
  generateDtsImports: () => string
  /** Returns DTS export declaration(s) for the generated client.d.ts. */
  generateDtsExports: () => string
}

export interface ZodvexConfig {
  client?: {
    /** Explicit list of integration names to enable. */
    integrations?: string[]
    /**
     * When true, checks the consumer's package.json dependencies
     * (not node_modules) for known integration peer packages.
     * Explicit `integrations` list takes precedence.
     */
    autoDetect?: boolean
  }
}

/** Helper for type-safe config files. */
export function defineConfig(config: ZodvexConfig): ZodvexConfig {
  return config
}

/** Registry of built-in integration plugins keyed by name. */
const builtinIntegrations = new Map<string, () => ClientIntegration>()

export function registerBuiltinIntegration(name: string, factory: () => ClientIntegration): void {
  builtinIntegrations.set(name, factory)
}

export function getBuiltinIntegration(name: string): ClientIntegration | undefined {
  const factory = builtinIntegrations.get(name)
  return factory?.()
}

export function getAllBuiltinIntegrations(): ClientIntegration[] {
  return Array.from(builtinIntegrations.values()).map(f => f())
}

/**
 * Checks if a package is listed in a project's package.json dependencies
 * (not devDependencies — client integrations should be production deps).
 * Does NOT use require.resolve to avoid false positives from auto-install.
 */
export function isExplicitDependency(pkg: string, projectRoot: string): boolean {
  try {
    const pkgJsonPath = path.join(projectRoot, 'package.json')
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    return !!(pkgJson.dependencies?.[pkg] || pkgJson.devDependencies?.[pkg])
  } catch {
    return false
  }
}

/**
 * Loads zodvex config from the project root.
 * Checks for zodvex.config.ts, zodvex.config.js, zodvex.config.json in order.
 */
export async function loadConfig(projectRoot: string): Promise<ZodvexConfig> {
  const candidates = ['zodvex.config.ts', 'zodvex.config.js', 'zodvex.config.json']

  for (const filename of candidates) {
    const configPath = path.join(projectRoot, filename)
    if (!fs.existsSync(configPath)) continue

    if (filename.endsWith('.json')) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ZodvexConfig
    }

    // Dynamic import for .ts/.js — works with bun, tsx, etc.
    const mod = await import(configPath)
    return (mod.default ?? mod) as ZodvexConfig
  }

  return {}
}

/**
 * Resolves the final list of ClientIntegration plugins from config + autoDetect.
 */
export function resolveIntegrations(
  config: ZodvexConfig,
  projectRoot: string
): ClientIntegration[] {
  const enabledNames = new Set<string>()

  // Explicit integrations always included
  if (config.client?.integrations) {
    for (const name of config.client.integrations) {
      enabledNames.add(name)
    }
  }

  // autoDetect adds integrations whose peer dependency is in package.json
  if (config.client?.autoDetect) {
    for (const integration of getAllBuiltinIntegrations()) {
      if (isExplicitDependency(integration.peerDependency, projectRoot)) {
        enabledNames.add(integration.name)
      }
    }
  }

  const resolved: ClientIntegration[] = []
  for (const name of enabledNames) {
    const integration = getBuiltinIntegration(name)
    if (integration) {
      resolved.push(integration)
    } else {
      console.warn(`[zodvex] Unknown integration: "${name}". Skipping.`)
    }
  }

  return resolved
}
