import { getPrismaClient } from '../src/platform/node/prisma.js'

const prisma = getPrismaClient()
const TRACE_ID = '434649d7-16f8-4e41-a949-1b68901f6011'

const row = await prisma.api_request_logs.findUnique({
  where: { id: TRACE_ID }
})

if (!row) {
  const rows = await prisma.api_request_logs.findMany({
    where: { id: { contains: '434649d7' } },
    take: 5,
    orderBy: { started_at: 'desc' }
  })
  if (rows.length) {
    console.log('Partial matches:')
    rows.forEach(r => console.log(r.id, r.path, r.duration_ms + 'ms', r.started_at))
  } else {
    console.log('No records found for this trace ID')
  }
} else {
  const trace = row.trace_json ? JSON.parse(row.trace_json) : null
  console.log(JSON.stringify({
    id: row.id,
    path: row.path,
    status: row.status,
    stage: row.stage,
    duration_ms: row.duration_ms,
    started_at: row.started_at,
    finished_at: row.finished_at,
    trace
  }, null, 2))
}
