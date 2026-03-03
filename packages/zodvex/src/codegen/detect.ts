import type { ClientFileOptions } from './generate'

/**
 * Auto-detect which optional form integrations are available
 * by checking if their peer dependencies resolve from the consumer's project.
 */
export function detectFormIntegrations(projectRoot: string): ClientFileOptions {
  return {
    form: {
      mantine: canResolve('mantine-form-zod-resolver', projectRoot)
    }
  }
}

/**
 * Check if a package can be resolved from a given directory.
 */
export function canResolve(pkg: string, fromDir: string): boolean {
  try {
    require.resolve(pkg, { paths: [fromDir] })
    return true
  } catch {
    return false
  }
}
