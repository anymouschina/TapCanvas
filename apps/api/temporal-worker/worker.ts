import { NativeConnection, Worker } from '@temporalio/worker'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

async function run() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)

  const connection = await NativeConnection.connect()

  const worker = await Worker.create({
    connection,
    workflowsPath: path.join(__dirname, 'workflows'),
    activities: await import('./activities/flow.activities'),
    taskQueue: 'flow-task-queue',
  })

  await worker.run()
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})

