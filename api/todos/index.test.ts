import 'mocha'
import { Todo } from './types'
import { Sql, inject, expect } from '../test'

describe('/todos', () => {

  let sql: Sql

  beforeEach(inject(({ _sql }) => {
    sql = _sql
  }))

  it('works!', async () => {
    const [todo]: Todo[] = await sql`
      select 1 as "todoId",
             'Test-Driven Development' as "task",
             false as "isCompleted"
    `
    expect(todo).to.have.structure({
      todoId: 1,
      task: 'Test-Driven Development',
      isCompleted: false
    })

  })

})
