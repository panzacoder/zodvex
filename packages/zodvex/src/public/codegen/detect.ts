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
