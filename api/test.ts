import 'mocha'
import chai, { expect } from 'chai'
import { chaiStruct } from 'chai-struct'
import connectToPostgres, { Sql, Trx } from '../services/connect-to-postgres'

chai.use(chaiStruct)

type Dependencies = {
  _sql: Sql
}

let sql: Sql
let rootTrx: Trx
let testTrx: Trx
let rollbackRoot: () => void
let rollbackTest: () => void

before('connect to database', done => {
  (async () => {
    sql = await connectToPostgres()
    await sql.begin(async sql => {
      rootTrx = sql
      await new Promise((resolve, reject) => {
        rollbackRoot = reject
        done()
      })
    }).catch(() => sql.end())
  })().catch(done)
})

beforeEach('begin a test transaction', done => {
  (async () => {
    await rootTrx.savepoint(async trx => {
      testTrx = trx
      await new Promise((resolve, reject) => {
        rollbackTest = reject
        done()
      })
    }).catch(noop)
  })().catch(done)
})

afterEach('rollback test transaction', done => {
  (async () => {
    rollbackTest()
    done()
  })().catch(done)
})

after('disconnect from database', done => {
  (async () => {
    rollbackRoot()
    done()
  })().catch(done)
})

type Setup = (dependencies: Dependencies) => Promise<void> | void

const noop = (): void => {}

const inject = (setup: Setup) => (done: Mocha.Done) => {
  (async () => {
    await setup({ _sql: testTrx })
    done()
  })().catch(done)
}

export { Sql, inject, expect }
