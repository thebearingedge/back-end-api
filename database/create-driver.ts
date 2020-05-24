import { Pool, Client, PoolClient, QueryResult } from 'pg'

type Many<T> = T | T[]

type Data =
  | boolean
  | number
  | string
  | null
  | undefined
  | Data[]
  | { [key: string]: Data }
  | { toJSON: () => string }

type Row = Record<string, Data>

type Connection = Pool | Client | PoolClient

type Result<T extends Row> = T[] & Omit<QueryResult, 'rows'>

type QueryArgs = Array<Data | Insert>

type Queryable = {
  <T extends Row>(template: TemplateStringsArray, ...args: QueryArgs): Promise<Result<T>>
}

type Inserter = {
  insert: (rows: Many<Row>, ...cols: string[]) => Insert
  insertInto: (table: string, rows: Many<Row>) => Promise<void>
}

type Transactor = {
  begin: {
    (): Promise<Trx>
    <T extends Transaction>(transaction: T): Promise<ReturnType<T>>
  }
}

type Driver = Queryable & Inserter & Transactor

export type Sql = Driver & {
  disconnect: () => Promise<void>
}

type TransactionState = 'pending' | 'committed' | 'rolled back'

export type Trx = Driver & {
  commit: () => Promise<void>
  rollback: () => Promise<void>
  savepoint: () => Promise<void>
  getState: () => TransactionState
}

type Transaction = (trx: Trx) => Promise<any>

const { escapeIdentifier } = Client.prototype

class Insert {

  constructor(public rows: Row[], public cols: string[]) {}

}

const uniqueId = (() => {
  let id = 1
  return () => id < Number.MAX_SAFE_INTEGER ? `trx_${id++}` : `trx_${(id = 1)}`
})()

const toArray = <T>(value: Many<T>): T[] => {
  return Array.isArray(value) ? value : [value]
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
        const tuple = (): string => {
          return ` (${cols.map(() => `$${param++}`).join(', ')})`
        }
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
      rows = toArray(rows)
      cols = cols.length > 0
        ? cols
        : Object.keys(rows[0])
      return new Insert(rows, cols)
    },
    async insertInto(table: string, rows: Many<Row>) {
      rows = toArray(rows)
      const cols = Object.keys(rows[0])
      const statement = [`insert into ${escapeIdentifier(table)} `, '']
      const template = Object.assign(statement, {
        raw: statement
      })
      await sql(template, new Insert(rows, cols))
    }
  })
}

function createTrx(client: PoolClient, parentId?: string): Trx {
  let state: TransactionState = 'pending'
  const trxId = uniqueId()
  const trx = createSql(client, {
    getState: () => state,
    begin: async (transaction?: Transaction) => {
      await client.query(`savepoint ${escapeIdentifier(trxId)}`)
      const child = createTrx(client, trxId)
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
        throw new Error(`Cannot save transaction. Already ${state}.`)
      }
      await client.query(`savepoint ${escapeIdentifier(trxId)}`)
    },
    commit: async () => {
      if (state !== 'pending') {
        throw new Error(`Cannot commit transaction. Already ${state}.`)
      }
      await client.query('commit')
      state = 'committed'
    },
    rollback: async () => {
      if (state !== 'pending') {
        throw new Error(`Cannot roll back transaction. Already ${state}.`)
      }
      if (parentId == null) {
        await client.query('rollback')
        client.release()
      } else {
        await client.query(`rollback to ${escapeIdentifier(parentId)}`)
      }
      state = 'rolled back'
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
      const trx = createTrx(client)
      if (typeof transaction !== 'function') return trx
      try {
        const result = await transaction(trx)
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
