import { describe, expect, it } from 'bun:test'
import type { GenericDatabaseReader, GenericDataModel } from 'convex/server'
import type { GenericId } from 'convex/values'
import { zGetAll, zGetAllNonNull } from '../src/relationships'

// Mock data model for testing
type TestDataModel = GenericDataModel & {
  users: {
    document: {
      _id: GenericId<'users'>
      _creationTime: number
      name: string
      email: string
    }
    fieldPaths: '_id' | '_creationTime' | 'name' | 'email'
    indexes: Record<string, never>
    searchIndexes: Record<string, never>
    vectorIndexes: Record<string, never>
  }
}

type TestDoc = TestDataModel['users']['document']

// Create a mock database reader
function createMockDb(
  documents: Map<string, TestDoc | null>
): GenericDatabaseReader<TestDataModel> {
  return {
    get: async (id: GenericId<'users'>) => {
      return documents.get(id as string) ?? null
    }
  } as GenericDatabaseReader<TestDataModel>
}

describe('zGetAll', () => {
  it('returns all documents for valid IDs', async () => {
    const doc1: TestDoc = {
      _id: 'id1' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Alice',
      email: 'alice@example.com'
    }
    const doc2: TestDoc = {
      _id: 'id2' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Bob',
      email: 'bob@example.com'
    }

    const documents = new Map<string, TestDoc | null>([
      ['id1', doc1],
      ['id2', doc2]
    ])

    const db = createMockDb(documents)
    const ids = ['id1' as GenericId<'users'>, 'id2' as GenericId<'users'>]
    const result = await zGetAll(db, ids)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(doc1)
    expect(result[1]).toEqual(doc2)
  })

  it('returns null for missing documents', async () => {
    const doc1: TestDoc = {
      _id: 'id1' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Alice',
      email: 'alice@example.com'
    }

    const documents = new Map<string, TestDoc | null>([['id1', doc1]])

    const db = createMockDb(documents)
    const ids = ['id1' as GenericId<'users'>, 'id_missing' as GenericId<'users'>]
    const result = await zGetAll(db, ids)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(doc1)
    expect(result[1]).toBeNull()
  })

  it('returns empty array for empty input', async () => {
    const documents = new Map<string, TestDoc | null>()
    const db = createMockDb(documents)
    const ids: Array<GenericId<'users'>> = []
    const result = await zGetAll(db, ids)

    expect(result).toHaveLength(0)
    expect(result).toEqual([])
  })

  it('preserves order of IDs', async () => {
    const doc1: TestDoc = {
      _id: 'id1' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Alice',
      email: 'alice@example.com'
    }
    const doc2: TestDoc = {
      _id: 'id2' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Bob',
      email: 'bob@example.com'
    }

    const documents = new Map<string, TestDoc | null>([
      ['id1', doc1],
      ['id2', doc2]
    ])

    const db = createMockDb(documents)
    const ids = ['id2' as GenericId<'users'>, 'id1' as GenericId<'users'>]
    const result = await zGetAll(db, ids)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(doc2)
    expect(result[1]).toEqual(doc1)
  })
})

describe('zGetAllNonNull', () => {
  it('returns all documents for valid IDs', async () => {
    const doc1: TestDoc = {
      _id: 'id1' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Alice',
      email: 'alice@example.com'
    }
    const doc2: TestDoc = {
      _id: 'id2' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Bob',
      email: 'bob@example.com'
    }

    const documents = new Map<string, TestDoc | null>([
      ['id1', doc1],
      ['id2', doc2]
    ])

    const db = createMockDb(documents)
    const ids = ['id1' as GenericId<'users'>, 'id2' as GenericId<'users'>]
    const result = await zGetAllNonNull(db, ids)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(doc1)
    expect(result[1]).toEqual(doc2)
  })

  it('filters out null values for missing documents', async () => {
    const doc1: TestDoc = {
      _id: 'id1' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Alice',
      email: 'alice@example.com'
    }

    const documents = new Map<string, TestDoc | null>([['id1', doc1]])

    const db = createMockDb(documents)
    const ids = [
      'id1' as GenericId<'users'>,
      'id_missing' as GenericId<'users'>,
      'id_also_missing' as GenericId<'users'>
    ]
    const result = await zGetAllNonNull(db, ids)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(doc1)
  })

  it('returns empty array when all documents are missing', async () => {
    const documents = new Map<string, TestDoc | null>()
    const db = createMockDb(documents)
    const ids = ['id_missing1' as GenericId<'users'>, 'id_missing2' as GenericId<'users'>]
    const result = await zGetAllNonNull(db, ids)

    expect(result).toHaveLength(0)
    expect(result).toEqual([])
  })

  it('returns empty array for empty input', async () => {
    const documents = new Map<string, TestDoc | null>()
    const db = createMockDb(documents)
    const ids: Array<GenericId<'users'>> = []
    const result = await zGetAllNonNull(db, ids)

    expect(result).toHaveLength(0)
    expect(result).toEqual([])
  })

  it('preserves order of IDs after filtering', async () => {
    const doc1: TestDoc = {
      _id: 'id1' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Alice',
      email: 'alice@example.com'
    }
    const doc3: TestDoc = {
      _id: 'id3' as GenericId<'users'>,
      _creationTime: Date.now(),
      name: 'Charlie',
      email: 'charlie@example.com'
    }

    const documents = new Map<string, TestDoc | null>([
      ['id1', doc1],
      ['id3', doc3]
    ])

    const db = createMockDb(documents)
    const ids = [
      'id3' as GenericId<'users'>,
      'id_missing' as GenericId<'users'>,
      'id1' as GenericId<'users'>
    ]
    const result = await zGetAllNonNull(db, ids)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(doc3)
    expect(result[1]).toEqual(doc1)
  })
})
