import 'dotenv/config'
import connectToPostgres from '../database/connect-to-postgres'

type Message = {
  message: string
}

;(async () => {
  const sql = await connectToPostgres()
  const result = await sql.begin(async sql => {
    const [result]: Message[] = await sql`
      select 'hello!' as "message"
      where ${1} = 1
    `
    return result
  })
  console.log(result)
  await sql.disconnect()
})().catch(err => {
  console.error(err)
  process.exit(1)
})
