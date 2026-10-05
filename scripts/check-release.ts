import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'

const releaseScript = resolvePath('bin/release-beta')
// Execute the workflow's actual shell blocks so coverage cannot drift to a copy.
type ReleaseWorkflow = {
  on: { push: { branches: string[]; tags: string[] }; pull_request?: unknown }
  jobs: Record<
    string,
    {
      steps: { id?: string; run?: string; uses?: string; with?: { 'fetch-depth'?: number } }[]
      if?: string
      needs?: string[]
    }
  >
}
const workflow = Bun.YAML.parse(
  readFileSync('.github/workflows/release.yml', 'utf8')
) as ReleaseWorkflow
const script = workflow.jobs.plan.steps.find(s => s.id === 'plan')?.run
const resolve = workflow.jobs.release.steps.find(s => s.id === 'release-tag')?.run
assert.ok(script, 'release planning shell must exist')
assert.ok(resolve, 'release version check must exist')
const dir = mkdtempSync(join(tmpdir(), 'zodvex-release-plan-'))
try {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('init', '-q')
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'test'
  )
  mkdirSync(join(dir, 'packages/zodvex'), { recursive: true })
  const cases = [
    ['new beta on main', '0.8.0-beta.2', 'push', 'refs/heads/main', '', 'v0.8.0-beta.2'],
    ['stable skipped on main', '0.8.0', 'push', 'refs/heads/main', '', undefined],
    ['alpha on main', '0.8.0-alpha.1', 'push', 'refs/heads/main', '', 'v0.8.0-alpha.1'],
    ['rc on main', '0.8.0-rc.1', 'push', 'refs/heads/main', '', 'v0.8.0-rc.1'],
    ['unknown suffix skipped', '0.8.0-preview.1', 'push', 'refs/heads/main', '', undefined],
    ['explicit stable tag', '0.8.0', 'push', 'refs/tags/v0.8.0', '', 'v0.8.0'],
    [
      'release branch',
      '0.8.0-beta.2',
      'push',
      'refs/heads/release/v0.8.0-beta.2',
      '',
      'v0.8.0-beta.2'
    ],
    [
      'manual dispatch',
      '0.8.0-beta.2',
      'workflow_dispatch',
      'refs/heads/main',
      'v0.8.0-beta.2',
      'v0.8.0-beta.2'
    ]
  ]
  for (const [label, version, event, ref, input, expected] of cases) {
    writeFileSync(join(dir, 'packages/zodvex/package.json'), JSON.stringify({ version }))
    const output = join(dir, 'output')
    writeFileSync(output, '')
    const env = {
      ...process.env,
      EVENT_NAME: event,
      GITHUB_REF: ref,
      INPUT_TAG: input,
      GITHUB_OUTPUT: output
    }
    execFileSync('bash', ['-e', '-c', script], { cwd: dir, env })
    assert.equal(
      readFileSync(output, 'utf8'),
      expected ? `tag=${expected}\npublish=true\n` : '',
      label
    )
    if (expected)
      execFileSync('bash', ['-e', '-c', resolve], { cwd: dir, env: { ...env, TAG: expected } })
    console.log(`PASS: ${label}`)
  }
  git('tag', 'v0.8.0-beta.2')
  const output = join(dir, 'output')
  writeFileSync(output, '')
  execFileSync('bash', ['-e', '-c', script], {
    cwd: dir,
    env: {
      ...process.env,
      EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      INPUT_TAG: '',
      GITHUB_OUTPUT: output
    }
  })
  assert.equal(readFileSync(output, 'utf8'), '')
  console.log('PASS: already-tagged main version skipped')
  assert.throws(() =>
    execFileSync('bash', ['-e', '-c', resolve], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, TAG: 'v0.8.0-beta.3', GITHUB_OUTPUT: output }
    })
  )
  console.log('PASS: mismatched release version rejected')
  const checkout = workflow.jobs.plan.steps.find(s => s.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout?.with?.['fetch-depth'], 0, 'release planning must fetch all tags')
  assert.deepEqual(workflow.on.push.tags, ['v*'], 'version tag pushes must trigger releases')
  console.log('PASS: planning fetches tags and version tag pushes trigger releases')
  assert.deepEqual(workflow.on.push.branches, ['main', 'release/v*'])
  assert.equal(workflow.on.pull_request, undefined)
  assert.equal(workflow.jobs.test.if, "needs.plan.outputs.publish == 'true'")
  assert.deepEqual(workflow.jobs.release.needs, ['plan', 'test'])
  console.log('PASS: publishing waits for validation; PR branches do not release')

  // Run the real release script against a local bare remote. Stub only validation
  // and registry lookup: no network, workflow dispatch, or npm publishing occurs.
  const remote = join(dir, 'remote.git')
  const work = join(dir, 'work')
  const fakeBin = join(dir, 'bin')
  mkdirSync(work)
  mkdirSync(fakeBin)
  const localGit = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'pipe' })
  localGit('init', '--bare', remote)
  localGit('init', '-b', 'main')
  localGit('config', 'user.name', 'Release Test')
  localGit('config', 'user.email', 'release@example.invalid')
  localGit('config', 'commit.gpgsign', 'false')
  localGit('config', 'tag.gpgsign', 'false')
  mkdirSync(join(work, 'packages/zodvex'), { recursive: true })
  writeFileSync(join(work, 'packages/zodvex/package.json'), '{"version": "0.8.0-beta.1"}\n')
  localGit('add', '.')
  localGit('commit', '-m', 'Initial version')
  localGit('remote', 'add', 'origin', remote)
  localGit('push', '-u', 'origin', 'main')
  writeFileSync(
    join(remote, 'hooks/post-receive'),
    `#!/bin/sh
printf 'transaction\\n' >> "$GIT_DIR/transactions"
cat >> "$GIT_DIR/transactions"
`,
    { mode: 0o755 }
  )
  writeFileSync(
    join(fakeBin, 'bun'),
    `#!/bin/sh
if [ "$1" = run ] && [ "$2" = validate:local ]; then exit 0; fi
exec "$RELEASE_TEST_BUN" "$@"
`,
    { mode: 0o755 }
  )
  writeFileSync(join(fakeBin, 'npm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  execFileSync('bash', [releaseScript, '0.8.0-beta.2'], {
    cwd: work,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      RELEASE_TEST_BUN: process.execPath
    },
    stdio: 'pipe'
  })
  const transactions = readFileSync(join(remote, 'transactions'), 'utf8')
  assert.equal(
    transactions.match(/^transaction$/gm)?.length,
    1,
    'main and tag must arrive in one transaction'
  )
  assert.match(transactions, /refs\/heads\/main/)
  assert.match(transactions, /refs\/tags\/v0\.8\.0-beta\.2/)
  console.log('PASS: release script pushes main and tag atomically')
  const planAtWork = (ref: string) => {
    writeFileSync(output, '')
    execFileSync('bash', ['-e', '-c', script], {
      cwd: work,
      env: {
        ...process.env,
        EVENT_NAME: 'push',
        GITHUB_REF: ref,
        INPUT_TAG: '',
        GITHUB_OUTPUT: output
      }
    })
    return readFileSync(output, 'utf8')
  }
  assert.equal(planAtWork('refs/heads/main'), '')
  assert.equal(planAtWork('refs/tags/v0.8.0-beta.2'), 'tag=v0.8.0-beta.2\npublish=true\n')
  console.log('PASS: atomic release selects only the tag publishing path')

  // A tag-less credential must fail before changing remote main, rather than
  // starting an automatic publication and then reporting a failed tag push.
  const remoteHead = localGit('--git-dir', remote, 'rev-parse', 'refs/heads/main').toString()
  writeFileSync(
    join(remote, 'hooks/update'),
    `#!/bin/sh
case "$1" in refs/tags/*) exit 1 ;; esac
`,
    { mode: 0o755 }
  )
  assert.throws(() =>
    execFileSync('bash', [releaseScript, '0.8.0-beta.3'], {
      cwd: work,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        RELEASE_TEST_BUN: process.execPath
      },
      stdio: 'pipe'
    })
  )
  assert.equal(localGit('--git-dir', remote, 'rev-parse', 'refs/heads/main').toString(), remoteHead)
  assert.equal(readFileSync(join(remote, 'transactions'), 'utf8'), transactions)
  console.log('PASS: rejected tag leaves remote main unchanged')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
