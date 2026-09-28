import type { IndexNames, SearchIndexNames, VectorIndexNames } from 'convex/server'
import { z } from 'zod'
import { z as zm } from 'zod/mini'
import { defineZodModel } from '../src'
import { defineZodModel as defineMiniZodModel } from '../src/mini'
import type { ZodvexDatabaseReader } from '../src/internal/db'
import {
  defineZodSchema,
  type InferDataModel,
  type InferDecodedDoc,
  type InferTableInfo
} from '../src/internal/schema'
import type { Equal, Expect } from './test-helpers'

// A staged index is deliberately invisible to the data model: Convex will not
// let a query use one, so it must not reach IndexNames / withIndex.
const tasks = defineZodModel('tasks', {
  title: z.string(),
  channel: z.string(),
  body: z.string(),
  embedding: z.array(z.number())
})
  .index('by_title', ['title'])
  .index('by_channel', ['channel'], { staged: true })
  .searchIndex('search_title', { searchField: 'title' })
  .searchIndex('search_body', { searchField: 'body', staged: true })
  .vectorIndex('vec_embedding', { vectorField: 'embedding', dimensions: 3 })
  .vectorIndex('vec_title', { vectorField: 'embedding', dimensions: 3, staged: true })

type TasksModel = typeof tasks
// Staged entries are held in their own record and never widen the queryable one.
type _StagedIndexIsNotQueryable = Expect<Equal<keyof TasksModel['indexes'], 'by_title'>>
type _StagedSearchIndexIsNotQueryable = Expect<
  Equal<keyof TasksModel['searchIndexes'], 'search_title'>
>
type _StagedVectorIndexIsNotQueryable = Expect<
  Equal<keyof TasksModel['vectorIndexes'], 'vec_embedding'>
>
type _StagedRecordsExist = Expect<
  Equal<
    keyof Pick<
      TasksModel,
      'stagedIndexes' | 'stagedSearchIndexes' | 'stagedVectorIndexes'
    >,
    'stagedIndexes' | 'stagedSearchIndexes' | 'stagedVectorIndexes'
  >
>

const schema = defineZodSchema({ tasks })
type TasksTable = InferTableInfo<typeof schema, 'tasks'>

const liveIndex: IndexNames<TasksTable> = 'by_title'
// @ts-expect-error — a staged index cannot be queried until `staged` is dropped
const stagedIndex: IndexNames<TasksTable> = 'by_channel'

const liveSearch: SearchIndexNames<TasksTable> = 'search_title'
// @ts-expect-error — a staged search index cannot be queried either
const stagedSearch: SearchIndexNames<TasksTable> = 'search_body'

const liveVector: VectorIndexNames<TasksTable> = 'vec_embedding'
// @ts-expect-error — a staged vector index cannot be queried either
const stagedVector: VectorIndexNames<TasksTable> = 'vec_title'

declare const db: ZodvexDatabaseReader<
  InferDataModel<typeof schema>,
  { tasks: InferDecodedDoc<typeof schema, 'tasks'> }
>
db.query('tasks').withIndex('by_title')
// @ts-expect-error — withIndex rejects a staged index
db.query('tasks').withIndex('by_channel')

// Field paths are still validated on a staged index.
tasks.index('by_title_staged', ['title'], { staged: true })
tasks.index('by_body_staged', { fields: ['body'], staged: true })
// @ts-expect-error — 'nope' is not a field on this model
tasks.index('by_bad', ['nope'], { staged: true })
// @ts-expect-error — Convex's object form validates field paths too
tasks.index('by_bad', { fields: ['nope'], staged: true })

// Convex's object form without `staged` stays queryable.
const objectForm = defineZodModel('events', { title: z.string() }).index('by_title', {
  fields: ['title']
})
type _ObjectFormIsQueryable = Expect<Equal<keyof (typeof objectForm)['indexes'], 'by_title'>>

// `staged` must be a literal, exactly as in Convex: a widened boolean matches
// neither overload. Use `as const` to satisfy the flag.
const opts = { staged: true }
// @ts-expect-error — `staged: boolean` is neither `{ staged: true }` nor `{ staged?: false }`
tasks.index('by_channel', ['channel'], opts)
// @ts-expect-error — same for Convex's object form
tasks.index('by_channel', { fields: ['channel'], staged: true as boolean })
tasks.index('by_channel', ['channel'], { staged: true } as const)

export { liveIndex, liveSearch, liveVector, stagedIndex, stagedSearch, stagedVector }

// The mini model type is a separate hand-mirrored copy of the same overloads,
// so it needs the same guarantees.
const miniDocs = defineMiniZodModel('docs', {
  body: zm.string(),
  channel: zm.string()
})
  .index('by_body', ['body'])
  .index('by_channel', ['channel'], { staged: true })
  .searchIndex('search_body', { searchField: 'body' })
  .searchIndex('search_channel', { searchField: 'channel', staged: true })

type MiniDocsModel = typeof miniDocs
type _MiniStagedIndexIsNotQueryable = Expect<Equal<keyof MiniDocsModel['indexes'], 'by_body'>>
type _MiniStagedSearchIndexIsNotQueryable = Expect<
  Equal<keyof MiniDocsModel['searchIndexes'], 'search_body'>
>

const miniSchema = defineZodSchema({ docs: miniDocs })
type MiniDocsTable = InferTableInfo<typeof miniSchema, 'docs'>

const miniLiveIndex: IndexNames<MiniDocsTable> = 'by_body'
// @ts-expect-error — a staged index is not queryable on mini models either
const miniStagedIndex: IndexNames<MiniDocsTable> = 'by_channel'

const miniLiveSearch: SearchIndexNames<MiniDocsTable> = 'search_body'
// @ts-expect-error — nor is a staged search index
const miniStagedSearch: SearchIndexNames<MiniDocsTable> = 'search_channel'

// @ts-expect-error — field paths are validated on a staged mini index
miniDocs.index('by_bad', ['nope'], { staged: true })

export { miniLiveIndex, miniLiveSearch, miniStagedIndex, miniStagedSearch }
