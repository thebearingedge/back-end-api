import 'mocha'
import connectToPostgres, { Sql, Trx } from '../database/connect-to-postgres'

let rootDb: Sql
let rootTrx: Trx
let testTrx: Trx

before('connect to database', done => {
  (async () => {
    rootDb = await connectToPostgres()
    rootTrx = await rootDb.begin()
    await rootTrx`
      create table "users" (
        "username"    text,
        "dateOfBirth" timestamptz(6)
      )
    `
    done()
  })().catch(done)
})

beforeEach('begin a test transaction', done => {
  (async () => {
    testTrx = await rootTrx.begin()
    done()
  })().catch(done)
})

afterEach('rollback test transaction', done => {
  (async () => {
    await testTrx.rollback()
    done()
  })().catch(done)
})

after('disconnect from database', done => {
  (async () => {
    await rootTrx.rollback()
    await rootDb.disconnect()
    done()
  })().catch(done)
})

type Dependencies = {
  _sql: Trx
}

type Setup = (dependencies: Dependencies) => Promise<void> | void

export const inject = (setup: Setup) => (done: MochaDone) => {
  (async () => {
    await setup({ _sql: testTrx })
    done()
  })().catch(done)
}

export { expect } from 'chai'
