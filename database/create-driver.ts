import util from 'util'
import zip from 'lodash/zip'
import flatten from 'lodash/flatten'
import uniqueId from 'lodash/uniqueId'
import { Client, Pool, PoolClient, QueryResult } from 'pg'

const { escapeIdentifier } = Client.prototype

type Result<T> = T[] & Omit<QueryResult, 'rows'>

type SQL = <T>(template: TemplateStringsArray, ...values: any[]) => Promise<Result<T>>

type Transactor = {
  begin<T extends Transaction>(transacting: T): TrxResult<T>
}

export type Driver = SQL & Transactor & {
  disconnect: () => Promise<void>
}

type Transaction = (trx: Trx) => any

type TransactionState = 'pending' | 'committed' | 'rolled back'

type TrxResult<T extends Transaction> = Promise<ReturnType<T>>

type TransactionConfig = {
  client: Client | PoolClient
  parent: Trx | null
}

type Trx = SQL & Transactor & {
  commit: () => Promise<void>
  rollback: () => Promise<void>
  savepoint: () => Promise<void>
  getState: () => TransactionState
}

function createSQL<T>(connection: Client | PoolClient | Pool, methods: T): SQL & T {
  async function sql<T>(template: TemplateStringsArray, ...values: any[]): Promise<Result<T>> {
    const params = values.map((_, index) => `$${++index}`)
    const text = flatten(zip(template, params.concat(''))).join('')
    const { rows, ...result } = await connection.query({
      text,
      values
    })
    return Object.assign(rows, result)
  }
  return Object.assign(sql, methods)
}

function createTransaction({ client, parent }: TransactionConfig): Trx {

  const id = uniqueId()
  let state: TransactionState = 'pending'

  const sql = createSQL(client, {
    getState: () => state,
    begin: async (transaction: Transaction) => {
      const trx = createTransaction({ client, parent: null })
      try {
        await trx.savepoint()
        const pending = transaction(trx)
        if (!util.types.isPromise(pending)) return pending
        const result = await pending
        if (trx.getState() !== 'pending') return result
        await trx.savepoint()
        return result
      } catch (err) {
        await trx.rollback()
        throw err
      }
    },
    savepoint: async () => {
      if (state !== 'pending') {
        throw new Error(`Transaction may not be saved after being ${state}.`)
      }
      await client.query(`savepoint ${escapeIdentifier(String(id))}`)
    },
    commit: async () => {
      if (state !== 'pending') {
        throw new Error(`Transaction may not be committed after being ${state}.`)
      }
      await (parent ?? sql)`commit`
      state = 'committed'
    },
    rollback: async () => {
      if (state !== 'pending') {
        throw new Error(`Transaction may not be rolled back after being ${state}.`)
      }
      parent == null
        ? await client.query('rollback')
        : await client.query(`rollback to ${escapeIdentifier(String(id))}`)
      state = 'rolled back'
    }
  })

  return sql
}

export default function createDriver(pool: Pool): Driver {
  return createSQL(pool, {
    disconnect: async () => pool.end(),
    begin: async (transaction: Transaction) => {
      const client = await this.client.connect()
      const sql = createTransaction({ client, parent: null })
      try {
        await sql`begin`
        const pending = transaction(sql)
        if (!util.types.isPromise(pending)) return pending
        const result = await pending
        if (sql.getState() !== 'pending') return result
        await sql.commit()
        return result
      } catch (err) {
        await sql.rollback()
        throw err
      } finally {
        client.release()
      }
    }
  })
}
