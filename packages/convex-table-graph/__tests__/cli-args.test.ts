import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CliUsageError, loadConfigFile, parseArgs, resolveAnalyzeOptions } from '../src/cli-args'

const configFixtures = path.join(__dirname, 'fixtures', 'cli-config')

describe('parseArgs', () => {
  it('uses sensible defaults', () => {
    const args = parseArgs([])
    expect(args.convexDir).toBe('convex')
    expect(args.format).toBe('json')
    expect(args.quiet).toBe(false)
    expect(args.builders).toBeUndefined()
    expect(args.maxDepth).toBeUndefined()
  })

  it('accepts a positional convex dir and all long flags', () => {
    const args = parseArgs([
      './app/convex',
      '--output',
      'graph.json',
      '--format',
      'ts',
      '--tsconfig',
      './tsconfig.json',
      '--max-depth',
      '5',
      '--config',
      './my.config.json',
      '--quiet'
    ])
    expect(args.convexDir).toBe('./app/convex')
    expect(args.output).toBe('graph.json')
    expect(args.format).toBe('ts')
    expect(args.tsConfigFilePath).toBe('./tsconfig.json')
    expect(args.maxDepth).toBe(5)
    expect(args.configPath).toBe('./my.config.json')
    expect(args.quiet).toBe(true)
  })

  it('parses repeatable --builder flags and dedupes names per kind', () => {
    const args = parseArgs([
      '--builder',
      'query=zq,hotpotQuery',
      '--builder',
      'mutation=zm',
      '--builder',
      'query=zq,extraQuery'
    ])
    expect(args.builders).toEqual({
      query: ['zq', 'hotpotQuery', 'extraQuery'],
      mutation: ['zm']
    })
  })

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(CliUsageError)
  })

  it('rejects an invalid format', () => {
    expect(() => parseArgs(['--format', 'yaml'])).toThrow(/expected "json" or "ts"/)
  })

  it('rejects a non-integer max depth', () => {
    expect(() => parseArgs(['--max-depth', 'lots'])).toThrow(/non-negative integer/)
  })

  it('rejects a builder spec without a kind', () => {
    expect(() => parseArgs(['--builder', 'zq,zm'])).toThrow(/expected <kind>=/)
  })

  it('rejects a builder spec with an unknown kind', () => {
    expect(() => parseArgs(['--builder', 'sprocket=zq'])).toThrow(/Invalid builder kind/)
  })

  it('rejects a flag missing its value', () => {
    expect(() => parseArgs(['--output'])).toThrow(/Missing value/)
  })
})

describe('loadConfigFile', () => {
  it('loads an explicit JSON config and resolves tsConfigFilePath relative to it', async () => {
    const configPath = path.join(configFixtures, 'convex-table-graph.config.json')
    const config = await loadConfigFile(configPath, 'convex')
    expect(config).not.toBeNull()
    expect(config!.builders).toEqual({
      query: ['zq', 'hotpotQuery'],
      mutation: ['zm']
    })
    expect(config!.maxDepth).toBe(5)
    expect(config!.tsConfigFilePath).toBe(path.join(configFixtures, 'convex', 'tsconfig.json'))
  })

  it('loads an explicit JS config via its default export', async () => {
    const configPath = path.join(configFixtures, 'js-config', 'table-graph.config.mjs')
    const config = await loadConfigFile(configPath, 'convex')
    expect(config!.builders).toEqual({
      internalMutation: ['zim', 'hotpotScheduledMutation']
    })
    expect(config!.maxDepth).toBe(2)
  })

  it('discovers a config in the cwd when no explicit path is given', async () => {
    const config = await loadConfigFile(undefined, 'convex', configFixtures)
    expect(config).not.toBeNull()
    expect(config!.maxDepth).toBe(5)
  })

  it('discovers a config next to the convex/ directory', async () => {
    const convexDir = path.join(configFixtures, 'convex')
    const config = await loadConfigFile(undefined, convexDir, '/')
    expect(config).not.toBeNull()
    expect(config!.maxDepth).toBe(5)
  })

  it('returns null when nothing is discovered', async () => {
    const config = await loadConfigFile(undefined, 'convex', path.join(configFixtures, 'js-config'))
    expect(config).toBeNull()
  })

  it('errors on an explicit path that does not exist', async () => {
    await expect(loadConfigFile('./no-such.config.json', 'convex', configFixtures)).rejects.toThrow(
      /not found/
    )
  })

  it('errors on a config with an unknown builder kind', async () => {
    const configPath = path.join(configFixtures, 'bad', 'convex-table-graph.config.json')
    await expect(loadConfigFile(configPath, 'convex')).rejects.toThrow(/unknown builder kind/)
  })
})

describe('resolveAnalyzeOptions', () => {
  it('passes through CLI-only options', () => {
    const cli = parseArgs(['./convex', '--max-depth', '4', '--builder', 'query=zq'])
    const options = resolveAnalyzeOptions(cli, null)
    expect(options.convexDir).toBe(path.resolve('./convex'))
    expect(options.maxDepth).toBe(4)
    expect(options.builders).toEqual({ query: ['zq'] })
  })

  it('takes values from the config file when no flags are set', () => {
    const cli = parseArgs([])
    const options = resolveAnalyzeOptions(cli, {
      builders: { query: ['zq'] },
      maxDepth: 7,
      tsConfigFilePath: '/abs/tsconfig.json'
    })
    expect(options.maxDepth).toBe(7)
    expect(options.tsConfigFilePath).toBe('/abs/tsconfig.json')
    expect(options.builders).toEqual({ query: ['zq'] })
  })

  it('prefers CLI flags over config-file values and unions builder names', () => {
    const cli = parseArgs(['--max-depth', '2', '--builder', 'query=extraQuery'])
    const options = resolveAnalyzeOptions(cli, {
      builders: { query: ['zq'], mutation: ['zm'] },
      maxDepth: 9,
      tsConfigFilePath: '/from-config/tsconfig.json'
    })
    expect(options.maxDepth).toBe(2)
    expect(options.tsConfigFilePath).toBe('/from-config/tsconfig.json')
    expect(options.builders).toEqual({
      query: ['zq', 'extraQuery'],
      mutation: ['zm']
    })
  })
})
