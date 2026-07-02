/**
 * Live smoke test for convex-auto-optimistic against the real Convex dev
 * deployment. Uses BaseConvexClient — the exact machinery convex/react's
 * useMutation drives — so the real OptimisticLocalStore, real WebSocket
 * protocol, and real server reconciliation are all exercised.
 *
 * Proves, with timestamps:
 *   1. insert/patch/delete predictions appear in the local query result
 *      BEFORE the server acknowledges the mutation
 *   2. the server result reconciles cleanly (temp doc replaced by real doc)
 *   3. zodvex-encoded wire args are accepted by the deployed functions
 *
 * Run: bun run test/optimistic-smoke.ts   (needs .env.local with VITE_CONVEX_URL)
 */

import fs from 'node:fs'
import path from 'node:path'
import { BaseConvexClient, ConvexHttpClient } from 'convex/browser'
import { applyPredictionToStore, type Prediction } from 'convex-auto-optimistic'
import { api } from '../convex/_generated/api'
import { encodeArgs } from '../convex/_zodvex/client.js'
import { tableGraph } from '../src/table-graph.generated'

const CONVEX_URL =
  process.env.VITE_CONVEX_URL ??
  (() => {
    const envPath = path.resolve(import.meta.dir, '../.env.local')
    if (!fs.existsSync(envPath)) throw new Error('No .env.local found. Run `npx convex dev` first.')
    const match = fs.readFileSync(envPath, 'utf-8').match(/VITE_CONVEX_URL=(.+)/)
    if (!match?.[1]) throw new Error('VITE_CONVEX_URL not found in .env.local')
    return match[1].trim()
  })()

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

const LIST_ARGS = { paginationOpts: { numItems: 10, cursor: null } }

type TaskDoc = { _id: string; title?: string; status?: string }
type ListResult = { page: TaskDoc[]; isDone: boolean; continueCursor: string } | undefined

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  console.log('\n=== convex-auto-optimistic live smoke test ===')
  console.log(`deployment: ${CONVEX_URL}\n`)

  // --- setup: demo user (one-shot http client) ---
  const http = new ConvexHttpClient(CONVEX_URL)
  const wireEmail = { value: 'demo@example.com', tag: 'email' }
  let owner = (await http.query(api.users.getByEmail, { email: wireEmail } as never)) as {
    _id: string
  } | null
  if (!owner) {
    const ownerId = await http.mutation(api.users.create, {
      name: 'Demo',
      email: 'demo@example.com'
    })
    owner = { _id: ownerId as string }
  }
  console.log(`owner: ${owner._id}`)

  // --- live client with the tasks:list subscription the UI uses ---
  const client = new BaseConvexClient(CONVEX_URL, () => {})
  client.subscribe('tasks:list', LIST_ARGS)

  const listResult = () => client.localQueryResult('tasks:list', LIST_ARGS) as ListResult

  const deadline = Date.now() + 10_000
  while (listResult() === undefined) {
    if (Date.now() > deadline) throw new Error('tasks:list never loaded')
    await sleep(20)
  }
  console.log(`tasks:list loaded (${listResult()?.page.length} tasks)\n`)

  const applyOpts = { graph: tableGraph, apiRoot: api, mutationPath: '' }

  // ---------- INSERT ----------
  console.log('1. insert (tasks:create)')
  const title = `optimistic-smoke ${Date.now()}`
  const wireArgs = encodeArgs(api.tasks.create, {
    title,
    ownerId: owner._id,
    estimate: { hours: 1, minutes: 30 }
  } as never) as Record<string, unknown>
  assert(wireArgs.estimate === 90, 'encodeArgs turned {hours:1,minutes:30} into 90 wire minutes')

  const tempId = `optimistic:${Date.now()}`
  const insertPrediction: Prediction = {
    kind: 'insert',
    at: 'start',
    doc: {
      _id: tempId,
      _creationTime: Date.now(),
      status: 'todo',
      priority: null,
      createdAt: Date.now(),
      ...wireArgs
    }
  }

  const tSend = performance.now()
  const createPromise = client
    .mutation('tasks:create', wireArgs as never, {
      optimisticUpdate: (store) =>
        applyPredictionToStore(store, insertPrediction, {
          ...applyOpts,
          mutationPath: 'tasks:create'
        })
    })
    .then((id) => ({ id: id as string, tAck: performance.now() }))

  // Synchronous check — the optimistic doc must be visible before ANY
  // network round trip could have completed.
  const syncPage = listResult()?.page ?? []
  const tVisible = performance.now()
  assert(syncPage[0]?._id === tempId, 'optimistic doc at top of first page in the same tick')

  const { id: realId, tAck } = await createPromise
  console.log(
    `  timing: optimistic visible after ${(tVisible - tSend).toFixed(1)}ms, server ack after ${(tAck - tSend).toFixed(0)}ms`
  )
  assert(tVisible < tAck, 'optimistic update landed before server acknowledgement')

  // Reconciliation: temp doc rolled back, real doc arrives via subscription.
  const recDeadline = Date.now() + 10_000
  for (;;) {
    const page = listResult()?.page ?? []
    const hasTemp = page.some((t) => t._id === tempId)
    const hasReal = page.some((t) => t._id === realId)
    if (!hasTemp && hasReal) break
    if (Date.now() > recDeadline) {
      assert(false, 'reconciliation: temp doc replaced by real doc')
      break
    }
    await sleep(20)
  }
  assert(true, 'reconciliation: temp doc replaced by real doc')

  // ---------- PATCH ----------
  console.log('2. patch (tasks:complete)')
  const patchPrediction: Prediction = {
    kind: 'patch',
    id: realId,
    changes: { status: 'done', completedAt: Date.now() }
  }
  const completePromise = client.mutation(
    'tasks:complete',
    { id: realId },
    {
      optimisticUpdate: (store) =>
        applyPredictionToStore(store, patchPrediction, {
          ...applyOpts,
          mutationPath: 'tasks:complete'
        })
    }
  )
  const patched = listResult()?.page.find((t) => t._id === realId)
  assert(patched?.status === 'done', 'status flipped to done in the same tick')
  await completePromise
  await sleep(500)
  const confirmed = listResult()?.page.find((t) => t._id === realId)
  assert(confirmed?.status === 'done', 'server-confirmed doc still done after reconciliation')

  // ---------- DELETE ----------
  console.log('3. delete (tasks:remove)')
  const deletePrediction: Prediction = { kind: 'delete', id: realId }
  const removePromise = client.mutation(
    'tasks:remove',
    { id: realId },
    {
      optimisticUpdate: (store) =>
        applyPredictionToStore(store, deletePrediction, {
          ...applyOpts,
          mutationPath: 'tasks:remove'
        })
    }
  )
  assert(
    !(listResult()?.page ?? []).some((t) => t._id === realId),
    'doc gone from first page in the same tick'
  )
  await removePromise
  await sleep(500)
  assert(
    !(listResult()?.page ?? []).some((t) => t._id === realId),
    'doc still gone after server confirmation'
  )

  // ---------- usePaginatedQuery internal variant ----------
  // convex/react's usePaginatedQuery subscribes with paginationOpts carrying
  // an extra `id` field. Two things must hold: the server validator accepts
  // the extra field (zx-style full pagination validator), and the first-page
  // detection (cursor === null) patches this variant too.
  console.log('4. usePaginatedQuery-shaped subscription')
  const PAGINATED_ARGS = { paginationOpts: { numItems: 5, cursor: null, id: 1 } }
  client.subscribe('tasks:list', PAGINATED_ARGS)
  const pagDeadline = Date.now() + 10_000
  const paginatedResult = () =>
    client.localQueryResult('tasks:list', PAGINATED_ARGS) as ListResult
  for (;;) {
    try {
      if (paginatedResult() !== undefined) break
    } catch (err) {
      assert(false, `server accepted usePaginatedQuery args (got: ${err})`)
      break
    }
    if (Date.now() > pagDeadline) throw new Error('paginated tasks:list never loaded')
    await sleep(20)
  }
  assert(paginatedResult() !== undefined, 'server accepted usePaginatedQuery-shaped args (extra id field)')

  const title2 = `optimistic-smoke-paginated ${Date.now()}`
  const wireArgs2 = encodeArgs(api.tasks.create, {
    title: title2,
    ownerId: owner._id,
    estimate: { hours: 0, minutes: 15 }
  } as never) as Record<string, unknown>
  const tempId2 = `optimistic:paginated:${Date.now()}`
  const insertPrediction2: Prediction = {
    kind: 'insert',
    at: 'start',
    doc: {
      _id: tempId2,
      _creationTime: Date.now(),
      status: 'todo',
      priority: null,
      createdAt: Date.now(),
      ...wireArgs2
    }
  }
  const create2Promise = client.mutation('tasks:create', wireArgs2 as never, {
    optimisticUpdate: (store) =>
      applyPredictionToStore(store, insertPrediction2, {
        ...applyOpts,
        mutationPath: 'tasks:create'
      })
  })
  assert(
    paginatedResult()?.page[0]?._id === tempId2,
    'optimistic doc at top of usePaginatedQuery first page in the same tick'
  )
  assert(
    listResult()?.page[0]?._id === tempId2,
    'raw useQuery variant patched by the same prediction'
  )
  const realId2 = (await create2Promise) as string

  // cleanup: remove the second task
  await client.mutation('tasks:remove', { id: realId2 })

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`)
  await client.close()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
