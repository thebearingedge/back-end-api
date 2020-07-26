import postgres from 'postgres'
import retry from 'promise-retry'

export type Sql = postgres.Sql<{}>

export type Trx = postgres.TransactionSql<{}>

export default async function connectToPostgres(): Promise<Sql> {
  return retry(async retry => {
    const sql = postgres(process.env.DATABASE_URL!)
    try {
      await sql`select 1`
      return sql
    } catch (err) /* istanbul ignore next */ {
      if (err.code === 'ETIMEDOUT') throw err
      return retry(err)
    }
  }, { retries: 5 })
}
