#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

function tryLoadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return
    dotenv.config({ path: filePath })
  } catch {
    // best effort
  }
}

function loadLocalEnvFiles() {
  const cwd = process.cwd()
  tryLoadEnvFile(path.resolve(cwd, '.env'))
  tryLoadEnvFile(path.resolve(cwd, '.dev.vars'))
  tryLoadEnvFile(path.resolve(cwd, 'apps/hono-api/.env'))
  tryLoadEnvFile(path.resolve(cwd, 'apps/hono-api/.dev.vars'))
}

function stringifyJson(value) {
  if (value == null) return '{}'
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return JSON.stringify(parsed)
    const sorted = Object.keys(parsed).sort().reduce((acc, key) => {
      acc[key] = parsed[key]
      return acc
    }, {})
    return JSON.stringify(sorted)
  } catch {
    return String(value)
  }
}

function groupBy(items, getKey) {
  const map = new Map()
  for (const item of items) {
    const key = getKey(item)
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }
  return map
}

async function main() {
  loadLocalEnvFiles()
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const platformOwnerId = String(process.env.COMMERCE_PLATFORM_OWNER_ID || '').trim()
  const prisma = new PrismaClient()

  try {
    const rows = await prisma.products.findMany({
      where: {
        product_entitlements: {
          some: {
            entitlement_type: { in: ['points_topup', 'monthly_quota', 'openclaw_subscription'] },
          },
        },
      },
      select: {
        id: true,
        owner_id: true,
        merchant_id: true,
        title: true,
        subtitle: true,
        currency: true,
        price_cents: true,
        stock: true,
        status: true,
        created_at: true,
        updated_at: true,
        product_entitlements: {
          select: {
            entitlement_type: true,
            config_json: true,
          },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: [{ owner_id: 'asc' }, { price_cents: 'asc' }, { created_at: 'asc' }],
    })

    const normalized = rows.flatMap((row) => row.product_entitlements.map((entitlement) => ({
      productId: row.id,
      ownerId: row.owner_id,
      merchantId: row.merchant_id,
      title: row.title,
      subtitle: row.subtitle,
      currency: row.currency,
      priceCents: row.price_cents,
      stock: row.stock,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      entitlementType: entitlement.entitlement_type,
      configJson: stringifyJson(entitlement.config_json),
      fingerprint: [
        row.title.trim(),
        row.currency,
        String(row.price_cents),
        entitlement.entitlement_type,
        stringifyJson(entitlement.config_json),
      ].join(' | '),
    })))

    const byOwner = groupBy(normalized, (item) => item.ownerId)
    const duplicateFingerprints = [...groupBy(normalized, (item) => item.fingerprint).entries()]
      .filter(([, items]) => items.length > 1)
      .sort((a, b) => b[1].length - a[1].length)

    console.log('=== Commerce Catalog Audit ===')
    console.log(`generatedAt=${new Date().toISOString()}`)
    console.log(`platformOwnerId=${platformOwnerId || '(unset)'}`)
    console.log(`totalCatalogRows=${normalized.length}`)
    console.log(`ownerCount=${byOwner.size}`)
    console.log('')

    console.log('--- Owners ---')
    for (const [ownerId, items] of [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const titles = [...new Set(items.map((item) => item.title))].sort()
      const entitlementTypes = [...new Set(items.map((item) => item.entitlementType))].sort()
      console.log(JSON.stringify({
        ownerId,
        packageCount: items.length,
        titles,
        entitlementTypes,
        isConfiguredPlatformOwner: platformOwnerId ? ownerId === platformOwnerId : false,
      }))
    }
    console.log('')

    console.log('--- Duplicate Fingerprints Across Owners ---')
    if (duplicateFingerprints.length === 0) {
      console.log('none')
    } else {
      for (const [fingerprint, items] of duplicateFingerprints) {
        const owners = [...new Set(items.map((item) => item.ownerId))].sort()
        console.log(JSON.stringify({
          fingerprint,
          rowCount: items.length,
          owners,
          productIds: items.map((item) => item.productId),
        }))
      }
    }
    console.log('')

    console.log('--- Candidate Canonical Sets ---')
    const ownerScores = [...byOwner.entries()].map(([ownerId, items]) => {
      const distinctFingerprints = new Set(items.map((item) => item.fingerprint)).size
      const distinctTitles = new Set(items.map((item) => item.title)).size
      return {
        ownerId,
        rowCount: items.length,
        distinctFingerprints,
        distinctTitles,
        earliestCreatedAt: items.reduce((min, item) => min && min < item.createdAt ? min : item.createdAt, ''),
      }
    }).sort((a, b) => {
      if (b.distinctFingerprints !== a.distinctFingerprints) return b.distinctFingerprints - a.distinctFingerprints
      if (b.rowCount !== a.rowCount) return b.rowCount - a.rowCount
      return a.earliestCreatedAt.localeCompare(b.earliestCreatedAt)
    })
    for (const item of ownerScores) {
      console.log(JSON.stringify(item))
    }
    console.log('')

    console.log('--- Rows ---')
    for (const item of normalized) {
      console.log(JSON.stringify(item))
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[audit-commerce-catalog] fail', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
