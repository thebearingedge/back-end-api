import util from 'util'
import uniqueId from 'lodash/uniqueId'
import castArray from 'lodash/castArray'
import { Pool, Client, PoolClient, QueryResult } from 'pg'

type Many<T> = T | T[]

type Data =
  | boolean
  | number
  | string
  | null
  | undefined
  | Data[]
  | { toJSON: () => string }
  | { [key: string]: Data }

type Row = Record<string, Data>

type Connection = Pool | Client | PoolClient

type Result<T extends Row> = T[] & Omit<QueryResult, 'rows'>

type Queryable = {
  <T extends Row>(template: TemplateStringsArray, ...args: Array<Data | Insert>): Promise<Result<T>>
}

type Inserter = {
  insert: (rows: Many<Row>, ...cols: string[]) => Insert
}

type Transactor = {
  begin: () => Promise<Trx>
  begin: <T extends Transaction>(transaction: T) => TrxResult<T>
}

type Driver = Queryable & Inserter & Transactor

type Sql = Driver & {
  disconnect: () => Promise<void>
}

type TransactionState = 'pending' | 'committed' | 'rolled back'

type Trx = Driver & {
  commit: () => Promise<void>
  rollback: () => Promise<void>
  savepoint: () => Promise<void>
  getState: () => TransactionState
}

type Transaction = (trx: Trx) => Promise<any>

type TrxResult<T extends Transaction> = Promise<ReturnType<T>>

type TransactionConfig = {
  client: PoolClient
  parentId?: string
}

const { escapeIdentifier } = Client.prototype

class Insert {

  constructor(public rows: Row[], public cols: string[]) {}

}

function createSql<M>(conn: Connection, methods: M): Queryable & Inserter & M {
  const sql: Queryable = async (template, ...args) => {
    let param = 1
    const values: Data[] = []
    const fragments = [...template]
    args.forEach((value, index) => {
      if (!(value instanceof Insert)) {
        values.push(value)
        fragments[index] += `$${param++}`
      } else {
        const { rows, cols } = value
        const tuple = (): string => ` (${cols.map(() => `$${param++}`).join(', ')})`
        const tuples: string[] = []
        rows.forEach(row => {
          tuples.push(tuple())
          cols.forEach(column => values.push(row[column]))
        })
        fragments[index] += `(${cols.map(escapeIdentifier).join(', ')}) values`
        fragments[index] += tuples.join(', ')
      }
    })
    const text = fragments.join('')
    const { rows, ...result } = await conn.query({
      text,
      values
    })
    return Object.assign(rows, result)
  }
  return Object.assign(sql, methods, {
    insert(rows: Many<Row>, ...cols: string[]): Insert {
      rows = castArray<Row>(rows)
      cols = cols.length > 0
        ? cols
        : Object.keys(rows[0])
      return new Insert(rows, cols)
    }
  })
}

function createTrx({ client, parentId }: TransactionConfig): Trx {

  const id = uniqueId('trx')
  let state: TransactionState = 'pending'

  const trx = createSql(client, {
    getState: () => state,
    begin: async (transaction?: Transaction) => {
      await client.query(`savepoint ${escapeIdentifier(id)}`)
      const child = createTrx({ client, parentId: id })
      if (typeof transaction !== 'function') return child
      try {
        const result = await transaction(child)
        if (child.getState() !== 'pending') return result
        await child.savepoint()
        return result
      } catch (err) {
        await child.rollback()
        throw err
      }
    },
    savepoint: async () => {
      if (state !== 'pending') {
        throw new Error(`Transaction can't be saved after being ${state}.`)
      }
      await client.query(`savepoint ${escapeIdentifier(id)}`)
    },
    commit: async () => {
      if (state !== 'pending') {
        throw new Error(`Transaction can't be committed after being ${state}.`)
      }
      await client.query('commit')
      state = 'committed'
    },
    rollback: async () => {
      if (state !== 'pending') {
        throw new Error(`Transaction can't be rolled back after being ${state}.`)
      }
      state = 'rolled back'
      if (parentId == null) {
        await client.query('rollback')
        client.release()
      } else {
        await client.query(`rollback to ${escapeIdentifier(parentId)}`)
      }
    }
  })
  return trx
}

export default function createDriver(pool: Pool): Sql {
  return createSql(pool, {
    disconnect: async () => pool.end(),
    begin: async (transaction?: Transaction) => {
      const client = await pool.connect()
      await client.query('begin')
      const trx = createTrx({ client })
      if (typeof transaction !== 'function') return trx
      try {
        const pending = transaction(trx)
        if (!util.types.isPromise(pending)) return pending
        const result = await pending
        if (trx.getState() !== 'pending') return result
        await trx.commit()
        return result
      } catch (err) {
        await trx.rollback()
        throw err
      } finally {
        client.release()
      }
    }
  })
}

export { Sql, Trx }
