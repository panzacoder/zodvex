import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const CONVEX_URL = process.env.CONVEX_URL
  ?? (() => {
    // Read from .env.local if not in env
    const envPath = path.resolve(import.meta.dir, '../.env.local')
    if (!fs.existsSync(envPath)) throw new Error('No .env.local found. Run `npx convex dev` first.')
    const content = fs.readFileSync(envPath, 'utf-8')
    const match = content.match(/CONVEX_URL=(.+)/)
    if (!match) throw new Error('CONVEX_URL not found in .env.local')
    return match[1]
  })()

const client = new ConvexHttpClient(CONVEX_URL)

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  pass ${message}`)
    passed++
  } else {
    console.error(`  FAIL ${message}`)
    failed++
  }
}

async function main() {
  console.log('\n=== zodvex Smoke Test ===\n')

  // --- Part 1: Codegen ---
  console.log('1. Codegen')

  const convexDir = path.resolve(import.meta.dir, '../convex')
  const zodvexDir = path.join(convexDir, '_zodvex')

  // Run codegen
  const result = spawnSync('bun', ['run', 'generate'], {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: 'pipe',
  })
  assert(result.status === 0, 'zodvex generate ran successfully')

  // Verify files exist
  assert(fs.existsSync(path.join(zodvexDir, 'schema.js')), 'schema.js generated')
  assert(fs.existsSync(path.join(zodvexDir, 'api.js')), 'api.js generated')

  // Verify schema.ts content
  const schemaContent = fs.readFileSync(path.join(zodvexDir, 'schema.js'), 'utf-8')
  assert(schemaContent.includes('AUTO-GENERATED'), 'schema.js has auto-generated header')
  assert(schemaContent.includes('UserModel'), 'schema.js exports UserModel')
  assert(schemaContent.includes('TaskModel'), 'schema.js exports TaskModel')
  assert(schemaContent.includes('CommentModel'), 'schema.js exports CommentModel')

  // Verify api.ts content
  const apiContent = fs.readFileSync(path.join(zodvexDir, 'api.js'), 'utf-8')
  assert(apiContent.includes('AUTO-GENERATED'), 'api.js has auto-generated header')
  assert(apiContent.includes('zodvexRegistry'), 'api.js exports registry')
  assert(apiContent.includes("'users:get'"), 'registry has users:get')
  assert(apiContent.includes("'tasks:list'"), 'registry has tasks:list')
  assert(apiContent.includes("'comments:create'"), 'registry has comments:create')

  // --- Part 2: Convex Functions ---
  console.log('\n2. Convex Functions')

  // Create a test user
  const userId = await client.mutation(api.users.create, {
    name: 'Smoke Test User',
    email: `smoke-${Date.now()}@test.com`,
  })
  assert(typeof userId === 'string', `user created: ${userId}`)

  // Get user back
  const user = await client.query(api.users.get, { id: userId })
  assert(user !== null, 'user retrieved')
  assert(user!.name === 'Smoke Test User', 'user name matches')
  assert(typeof user!.createdAt === 'number', `createdAt is wire format (number): ${user!.createdAt}`)

  // Create a task with duration estimate.
  // ConvexHttpClient talks to the raw Convex API, so codec args use wire format.
  const taskId = await client.mutation(api.tasks.create, {
    title: 'Smoke Test Task',
    ownerId: userId,
    priority: 'high',
    estimate: 90,
  })
  assert(typeof taskId === 'string', `task created: ${taskId}`)

  // Get task back
  const task = await client.query(api.tasks.get, { id: taskId })
  assert(task !== null, 'task retrieved')
  assert(task!.title === 'Smoke Test Task', 'task title matches')
  assert(task!.status === 'todo', 'task default status is todo')
  assert(task!.priority === 'high', 'task priority matches')
  assert(task!.ownerId === userId, 'task ownerId matches')
  assert(typeof task!.createdAt === 'number', `task createdAt is wire format: ${task!.createdAt}`)
  // NOTE: estimate is zDuration codec — the return type says {hours, minutes}
  // but the wire format is a number (minutes). This is a known boundary question:
  // should the return type reflect decoded or wire format?
  // For now, test the actual wire value.
  const rawEstimate = task!.estimate as unknown as number
  assert(typeof rawEstimate === 'number', `task estimate is wire format (number): ${rawEstimate}`)
  assert(rawEstimate === 90, 'task estimate value is 90 (minutes)')

  // Complete the task
  await client.mutation(api.tasks.complete, { id: taskId })
  const completedTask = await client.query(api.tasks.get, { id: taskId })
  assert(completedTask!.status === 'done', 'task status is done after complete')
  assert(typeof completedTask!.completedAt === 'number', 'completedAt is wire format after complete')

  // Create a comment
  const commentId = await client.mutation(api.comments.create, {
    taskId,
    authorId: userId,
    body: 'Smoke test comment',
  })
  assert(typeof commentId === 'string', `comment created: ${commentId}`)

  // List comments
  const comments = await client.query(api.comments.list, { taskId })
  assert(Array.isArray(comments), 'comments list is an array')
  assert(comments.length === 1, 'one comment returned')
  assert(comments[0].body === 'Smoke test comment', 'comment body matches')
  assert(typeof comments[0].createdAt === 'number', 'comment createdAt is wire format')

  // List tasks with pagination
  const taskPage = await client.query(api.tasks.list, {
    paginationOpts: { numItems: 10, cursor: null },
  })
  assert(taskPage.page !== undefined, 'paginated result has page')
  assert(taskPage.page.length >= 1, 'at least one task in page')

  // --- Part 3: Lazy registry import via action codec ---
  console.log('\n3. Action codec — verifies lazy `_zodvex/api.js` import')

  const resolvedName = await client.action(api.actions.resolveUserViaAction, { id: userId })
  assert(resolvedName === 'Smoke Test User', `action resolved user name via lazy registry: ${resolvedName}`)

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
