#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { buildObjectStorageUrl, resolveObjectStorageTarget, toHostedAssetKey } from './object-storage-config.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = path.join(scriptDir, '../.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key && !process.env[key]) process.env[key] = value
  }
}

function requireEnv(key) {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

loadEnv()

const newApiBase = (process.env.NEW_API_INTERNAL_BASE_URL || 'http://localhost:4455')
  .replace('new-api', 'localhost')
  .replace(/\/+$/, '')
const newApiToken = requireEnv('NEW_API_INTERNAL_TOKEN')
const storage = resolveObjectStorageTarget()
const { bucket } = storage
const s3 = new S3Client(storage.s3ClientConfig)

const sharedDirection = [
  'Use case: infographic-diagram.',
  'Asset type: premium capability poster for the TapCanvas homepage.',
  'Create one finished 4:3 editorial artwork, not an app screenshot and not a collection of UI cards.',
  'Visual language: cinematic production desk seen as an art installation, near-black matte field, clean ivory paper, brushed aluminum, translucent film material, one restrained coral-red accent #F06A5C used only as an editor annotation.',
  'Composition: bold asymmetrical Swiss editorial grid, one dominant visual metaphor, generous negative space, sharp hierarchy, refined studio lighting, tactile materials, museum-catalog polish.',
  'Typography: exact Simplified Chinese, crisp modern grotesk, strong title and five smaller labels integrated into the artwork as one composition.',
  'No generic sparkles, no purple or blue-dominated palette, no rounded pill buttons, no nested cards, no fake software interface, no logos, no watermark, no random text, no noise, no grain.',
].join('\n')

const posters = [
  {
    id: 'creative-agent',
    title: '创作 Agent',
    labels: ['剧本续写', '章节拆解', '素材提取', '分镜生产', '连续性管理'],
    direction: 'The dominant metaphor is a black-and-white Xiaot production intelligence arranging screenplay pages, red editorial marks, shot strips, and continuity threads into a single executable film plan. Human art direction remains visible as one precise hand setting the final standard.',
  },
  {
    id: 'image-craft',
    title: '图片能力',
    labels: ['文图生图', '智能修图', '高清放大', '扩图裁剪', '姿势编辑'],
    direction: 'The dominant metaphor is a portrait contact sheet evolving across one continuous artboard: source sketch, refined character, expanded environment, detail enlargement, and corrected body pose, all connected by restrained coral crop and retouch marks.',
  },
  {
    id: 'video-craft',
    title: '视频能力',
    labels: ['文生视频', '首尾帧视频', '多图参考', '视频超分', '镜头合成'],
    direction: 'The dominant metaphor is a physical film timeline crossing the poster from first frame to last frame, combining multiple image references, camera motion, temporal beats, and a final polished moving picture in one decisive visual arc.',
  },
  {
    id: 'sound-craft',
    title: '音频能力',
    labels: ['预设音色', '声音定制', '对白配音', '环境音效', '音轨合成'],
    direction: 'The dominant metaphor is a sculptural sound stage: voice waveform, dialogue performance, room ambience, foley objects, and a final multitrack mix converging into one clean cinematic master track.',
  },
]

async function generatePoster(poster) {
  const exactText = [poster.title, ...poster.labels].map((text) => `“${text}”`).join('、')
  const prompt = [
    sharedDirection,
    `Primary request: ${poster.direction}`,
    `Text (verbatim): render only ${exactText}. Every phrase must appear exactly once and must be legible.`,
  ].join('\n')

  const response = await fetch(`${newApiBase}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${newApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '4:3',
      resolution: '2K',
      quality: 'high',
      response_format: 'url',
    }),
    signal: AbortSignal.timeout(240_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${poster.id} generation failed [${response.status}]: ${detail.slice(0, 300)}`)
  }
  const payload = await response.json()
  const item = payload?.data?.[0]
  let bytes
  if (typeof item?.url === 'string' && item.url) {
    const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(90_000) })
    if (!imageResponse.ok) throw new Error(`${poster.id} download failed [${imageResponse.status}]`)
    bytes = new Uint8Array(await imageResponse.arrayBuffer())
  } else if (typeof item?.b64_json === 'string' && item.b64_json) {
    bytes = Buffer.from(item.b64_json, 'base64')
  } else {
    throw new Error(`${poster.id} response did not include an image URL or base64 payload`)
  }

  const objectKey = toHostedAssetKey(
    storage.provider,
    `static/portal/tc-home-capability-${poster.id}-v1-20260721.png`,
  )
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: bytes,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return { id: poster.id, prompt, url: buildObjectStorageUrl(storage.publicBase, objectKey) }
}

async function run() {
  const results = []
  for (let index = 0; index < posters.length; index += 2) {
    const batch = posters.slice(index, index + 2)
    const generated = await Promise.all(batch.map(generatePoster))
    results.push(...generated)
    for (const item of generated) console.log(`${item.id}: ${item.url}`)
  }
  console.log(JSON.stringify(results.map(({ id, url }) => ({ id, url })), null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
