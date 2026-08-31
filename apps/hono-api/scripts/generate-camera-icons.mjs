#!/usr/bin/env node
/**
 * generate-camera-icons.mjs
 *
 * 用 gpt-image-2（4455 端口）批量生成摄影机控制面板的图标（透明 PNG），
 * 上传到显式选择的对象存储，输出 URL 映射供前端组件直接嵌入。
 *
 * 用法:
 *   node scripts/generate-camera-icons.mjs [--dry-run] [--concurrency 2]
 *
 * 前置: 确保 .env 中的 OBJECT_STORAGE_PROVIDER、所选存储配置和 NEW_API_INTERNAL_TOKEN 已配置。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { buildObjectStorageUrl, resolveObjectStorageTarget, toHostedAssetKey } from './object-storage-config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── 读 .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envFile = path.join(__dirname, '../.env')
  if (!fs.existsSync(envFile)) return
  const lines = fs.readFileSync(envFile, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

const DRY_RUN = process.argv.includes('--dry-run')
const CONCURRENCY = Number(process.argv.find((_, i, a) => a[i - 1] === '--concurrency') ?? 2) || 2

const NEW_API_BASE = (process.env.NEW_API_INTERNAL_BASE_URL || 'http://localhost:4455').replace('new-api', 'localhost')
const NEW_API_TOKEN = process.env.NEW_API_INTERNAL_TOKEN || ''
function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
const storage = resolveObjectStorageTarget()

// ─── 图标定义 ─────────────────────────────────────────────────────────────
const ICONS = [
  // 摄影机机身
  {
    type: 'camera',
    key: 'imax_keighley',
    prompt: 'IMAX Keighley 65mm film cinema camera, large film magazine, vintage mechanical design, isolated on transparent background, 3/4 front angle, photorealistic product shot, soft studio lighting, dark metallic body',
  },
  {
    type: 'camera',
    key: 'arri_alexa35',
    prompt: 'ARRI Alexa 35 digital cinema camera, compact modern body with top handle, orange logo accent, isolated on transparent background, 3/4 front angle, photorealistic product shot, soft studio lighting',
  },
  {
    type: 'camera',
    key: 'arri_alexa_lf',
    prompt: 'ARRI Alexa LF large format digital cinema camera, wider body with side handle, isolated on transparent background, 3/4 front angle, photorealistic product shot, soft studio lighting, dark body',
  },
  {
    type: 'camera',
    key: 'red_komodo',
    prompt: 'RED Komodo 6K cinema camera, very compact cube-like body, red carbon fiber texture, isolated on transparent background, 3/4 front angle, photorealistic product shot, soft studio lighting',
  },
  {
    type: 'camera',
    key: 'sony_venice2',
    prompt: 'Sony Venice 2 full-frame cinema camera, Sony professional design with top handle, isolated on transparent background, 3/4 front angle, photorealistic product shot, soft studio lighting, dark body',
  },
  {
    type: 'camera',
    key: 'blackmagic_ursa',
    prompt: 'Blackmagic URSA Mini Pro cinema camera, boxy compact design with carbon pattern, isolated on transparent background, 3/4 front angle, photorealistic product shot, soft studio lighting',
  },
  // 镜头
  {
    type: 'lens',
    key: 'cooke_speed_panchro',
    prompt: 'Cooke Speed Panchro vintage cinema prime lens, brass and steel cylindrical barrel, focus ring with engraved markings, isolated on transparent background, front-left view, photorealistic product shot, soft studio lighting',
  },
  {
    type: 'lens',
    key: 'zeiss_master_prime',
    prompt: 'Zeiss Master Prime cinema lens, precision black metal barrel, white T-stop markings, large front element glass, isolated on transparent background, front-left view, photorealistic product shot, soft studio lighting',
  },
  {
    type: 'lens',
    key: 'leica_summilux_c',
    prompt: 'Leica Summilux-C cinema prime lens, compact cylindrical body, matte black finish, focus and iris gear rings, isolated on transparent background, front-left view, photorealistic product shot, soft studio lighting',
  },
  {
    type: 'lens',
    key: 'panavision_ultra_speed',
    prompt: 'Panavision Ultra Speed cinema prime lens, large barrel with external gear teeth, deep blue front element coating, isolated on transparent background, front-left view, photorealistic product shot, soft studio lighting',
  },
  {
    type: 'lens',
    key: 'arri_signature_prime',
    prompt: 'ARRI Signature Prime cinema lens, modern minimal design, LDS iris gear ring, smooth matte barrel, isolated on transparent background, front-left view, photorealistic product shot, soft studio lighting',
  },
  // 光圈
  {
    type: 'aperture',
    key: 'f/1.4',
    prompt: 'Camera aperture iris diaphragm with very wide open f/1.4 opening, curved metallic blades forming large circular opening, silver metallic finish, isolated on transparent background, top-down flat view, product shot',
  },
  {
    type: 'aperture',
    key: 'f/2',
    prompt: 'Camera aperture iris diaphragm with wide f/2 opening, curved metallic blades, silver finish, isolated on transparent background, top-down flat view, product shot',
  },
  {
    type: 'aperture',
    key: 'f/2.8',
    prompt: 'Camera aperture iris diaphragm with f/2.8 opening, slightly overlapping curved blades, silver metallic finish, isolated on transparent background, top-down flat view, product shot',
  },
  {
    type: 'aperture',
    key: 'f/4',
    prompt: 'Camera aperture iris diaphragm with medium f/4 opening, overlapping curved metallic blades, silver finish, isolated on transparent background, top-down flat view, product shot',
  },
  {
    type: 'aperture',
    key: 'f/5.6',
    prompt: 'Camera aperture iris diaphragm with narrow f/5.6 opening, multiple overlapping blades, small circular center opening, silver metallic finish, isolated on transparent background, top-down flat view, product shot',
  },
  {
    type: 'aperture',
    key: 'f/8',
    prompt: 'Camera aperture iris diaphragm showing very narrow f/8 opening, tightly closed metallic blades, tiny circular opening, silver finish, isolated on transparent background, top-down flat view, product shot',
  },
  {
    type: 'aperture',
    key: 'f/11',
    prompt: 'Camera aperture iris diaphragm showing tiny pinhole f/11 opening, nearly closed metallic blades, silver finish, isolated on transparent background, top-down flat view, product shot',
  },
]

// ─── 调用 gpt-image-2 ────────────────────────────────────────────────────
async function generateImage(icon) {
  const resp = await fetch(`${NEW_API_BASE}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(NEW_API_TOKEN ? { Authorization: `Bearer ${NEW_API_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: icon.prompt,
      n: 1,
      size: '1024x1024',
      quality: 'high',
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`生图失败 [${resp.status}]: ${text.slice(0, 200)}`)
  }
  const data = await resp.json()
  const item = data?.data?.[0]
  if (!item) throw new Error('响应中没有图片数据')
  if (item.b64_json) return { kind: 'base64', data: item.b64_json }
  if (item.url) return { kind: 'url', url: item.url }
  throw new Error('无法获取图片内容')
}

// ─── 上传到对象存储 ───────────────────────────────────────────────────────
const s3 = new S3Client(storage.s3ClientConfig)

async function uploadToObjectStorage(icon, imgData) {
  const key = toHostedAssetKey(
    storage.provider,
    `gen/camera-icons/${icon.type}/${icon.key.replace(/\//g, '_')}.png`,
  )

  let body
  if (imgData.kind === 'base64') {
    body = Buffer.from(imgData.data, 'base64')
  } else {
    const res = await fetch(imgData.url)
    if (!res.ok) throw new Error(`下载图片失败: ${res.status}`)
    body = Buffer.from(await res.arrayBuffer())
  }

  await s3.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    Body: body,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000, immutable',
    ContentLength: body.byteLength,
  }))

  return buildObjectStorageUrl(storage.publicBase, key)
}

// ─── 并发执行 ─────────────────────────────────────────────────────────────
async function processIcon(icon) {
  const label = `[${icon.type}/${icon.key}]`
  console.log(`${label} 开始生成...`)
  if (DRY_RUN) {
    console.log(`${label} dry-run，跳过`)
    return { ...icon, url: `DRY_RUN_${icon.key}` }
  }
  const imgData = await generateImage(icon)
  console.log(`${label} 生成完成，上传中...`)
  const url = await uploadToObjectStorage(icon, imgData)
  console.log(`${label} 完成: ${url}`)
  return { ...icon, url }
}

async function runWithConcurrency(items, fn, concurrency) {
  const results = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const settled = await Promise.allSettled(batch.map(fn))
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value)
      else {
        console.error('生成失败:', r.reason?.message || r.reason)
        results.push(null)
      }
    }
  }
  return results
}

// ─── 主流程 ───────────────────────────────────────────────────────────────
const results = await runWithConcurrency(ICONS, processIcon, CONCURRENCY)

const urlMap = { camera: {}, lens: {}, aperture: {} }
for (const r of results) {
  if (r?.url) urlMap[r.type][r.key] = r.url
}

console.log('\n✅ 生成完毕，URL 映射:\n')
console.log(JSON.stringify(urlMap, null, 2))

// 输出可直接粘贴到 CameraControlPanel.tsx 的常量
console.log('\n// ─── 粘贴到 CameraControlPanel.tsx ─────────────────────────────')
console.log('export const CAMERA_ICON_URLS: Record<string, Record<string, string>> =')
console.log(JSON.stringify(urlMap, null, 2))
