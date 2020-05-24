import 'mocha'
import { inject, Trx, expect } from '../test'

let sql: Trx

beforeEach(inject(({ _sql }) => {
  sql = _sql
}))

it('works!', async () => {
  await sql.begin(async sql => {

    const first = { username: 'foo', dateOfBirth: new Date() }
    const second = { username: 'bar', dateOfBirth: new Date() }
    await sql.insertInto('users', [second])
    const [bar]: Array<typeof second> = await sql`
      select *
        from "users"
    `
    expect(bar)
      .to.been.an('object')
      .that.includes({ username: 'bar' })
    const [foo]: Array<typeof first> = await sql`
      with "inserted" as (
        insert into "users"
        ${sql.insert(first)}
        returning *
      )
      select *
        from "inserted"
       where "username" = ${first.username}
    `
    expect(foo)
      .to.be.an('object')
      .that.deep.equals(first)
  })

})
