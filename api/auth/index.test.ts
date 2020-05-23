import 'mocha'
import { expect, inject } from '../test'
import { Trx } from '../../database/create-driver'

let sql: Trx

beforeEach(inject(({ _sql }) => {
  sql = _sql
}))

it('works!', async () => {
  const user = { username: 'foo', dateOfBirth: new Date() }
  const [foo]: Array<typeof user> = await sql`
    with "inserted" as (
      insert into "users"
      ${sql.insert(user)}
      returning *
    )
    select *
      from "inserted"
     where "username" = ${user.username}
  `
  expect(foo)
    .to.be.an('object')
    .that.deep.equals(user)
})
