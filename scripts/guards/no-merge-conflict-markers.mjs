import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const ROOT_DIR = process.cwd()
const TARGET_DIRS = ['apps/web', 'apps/hono-api', 'scripts', '.github', 'docs']
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.pnpm-store',
  '.wrangler',
  'coverage',
  'test-results',
  'dist-tmp',
])

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.DS_Store')) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      files.push(...(await collectFiles(fullPath)))
      continue
    }
    if (!entry.isFile()) continue
    files.push(fullPath)
  }
  return files
}

function shouldScanFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (!ext) return true
  return !['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.pdf', '.zip'].includes(ext)
}

function findMarker(content) {
  if (/^<<<<<<<\s/m.test(content)) return '<<<<<<<'
  if (/^=======\s*$/m.test(content)) return '======='
  if (/^>>>>>>>\s/m.test(content)) return '>>>>>>>'
  return null
}

async function collectTargetFiles() {
  const files = []
  for (const relDir of TARGET_DIRS) {
    const absDir = path.join(ROOT_DIR, relDir)
    const meta = await stat(absDir).catch(() => null)
    if (!meta || !meta.isDirectory()) continue
    files.push(...(await collectFiles(absDir)))
  }
  return files
}

async function main() {
  const allFiles = await collectTargetFiles()
  const violations = []
  for (const filePath of allFiles) {
    if (!shouldScanFile(filePath)) continue
    const content = await readFile(filePath, 'utf8').catch(() => '')
    if (!content) continue
    const marker = findMarker(content)
    if (!marker) continue
    violations.push({ filePath, marker })
  }

  if (violations.length > 0) {
    console.error('Found unresolved merge conflict markers:')
    for (const item of violations) {
      console.error(`- ${path.relative(ROOT_DIR, item.filePath)} (${item.marker})`)
    }
    process.exit(1)
  }

  console.log('No merge conflict markers found.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
