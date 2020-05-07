import 'dotenv/config'
import connectToPostgres from '../database/connect-to-postgres'

type Output = { message: string }

;(async () => {
  const sql = await connectToPostgres()
  const [result]: Output[] = await sql`select 'hello!' as "message"`
  console.log(result)
  await sql.disconnect()
})().catch(err => {
  console.error(err)
  process.exit(1)
})
