import pg from 'pg'
import retry from 'promise-retry'
import createDriver, { Sql, Trx } from './create-driver'

export default async function connectToPostgres(): Promise<Sql> {
  return retry(async retry => {
    const sql = createDriver(new pg.Pool({
      connectionString: process.env.DATABASE_URL
    }))
    try {
      await sql`select 1`
      return sql
    } catch (err) {
      console.error(err.message)
      if (err.code === 'ETIMEDOUT') throw err
      return retry(err)
    }
  }, { retries: 5 })
}

export { Sql, Trx }
