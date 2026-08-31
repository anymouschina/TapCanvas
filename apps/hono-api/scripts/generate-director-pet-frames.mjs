#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { buildObjectStorageUrl, resolveObjectStorageTarget, toHostedAssetKey } from './object-storage-config.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../../..')
const outputDir = path.join(repoRoot, 'tmp/imagegen/director-pet')
const reuseExisting = process.argv.includes('--reuse-existing')
const requestedStates = (() => {
  const argument = process.argv.find((value) => value.startsWith('--states='))
  if (!argument) return null
  return new Set(argument.slice('--states='.length).split(',').map((value) => value.trim()).filter(Boolean))
})()
const assetVersion = 'v3'
const sourcePortraitPath = path.join(repoRoot, 'apps/web/src/assets/team/xiaot.png')
const chromaRemovalScript = path.join(
  process.env.CODEX_HOME || path.join(process.env.HOME || '', '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
)
const sheetProcessingScript = path.join(scriptDir, 'process-director-pet-sheet.py')

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
  'Use case: stylized-concept.',
  'Asset type: four-frame full-body desktop pet animation sheet for the TapCanvas AI chat launcher.',
  'Use the attached Xiaot portrait as the strict identity reference: the exact same youthful male face, large blue-gray eyes, layered silver-white hair with the single upward forelock, black futuristic director jacket, and restrained cyan piping.',
  'Render exactly four distinct full-body poses in a precise 2 by 2 grid. Each quadrant contains exactly one complete Xiaot, viewed straight-on at the same camera angle, same body proportions, same character scale, same lighting, and same foot baseline within that quadrant.',
  'Cute polished Chinese animation character design with clean cel shading, crisp contours, premium game companion quality, expressive but restrained acting.',
  'Every quadrant background must be perfectly flat solid #00ff00 chroma key, including all corners and the ground behind the feet. No divider lines, no panel borders, no floor plane, no cast shadow, no reflection, no gradient, and no background objects.',
  'Keep generous clear padding around hair, hands, coat hem, and shoes. The entire head, hair tips, fingers, clothing, legs, and both shoes must remain visible in every quadrant.',
  'Do not use #00ff00 anywhere on the character. No text, no letters, no badges with writing, no logo, no watermark, no extra characters, no duplicate limbs, no cropped body, no perspective change, no grain, no noise.',
].join('\n')

const sheetSpecs = [
  {
    state: 'idle',
    direction: [
      'Create a seamless idle loop with subtle pose-to-pose variation only.',
      'Frame 1: relaxed neutral stance, eyes open, hands resting naturally at his sides.',
      'Frame 2: same stance at the top of a gentle inhale, shoulders lifted by only a few pixels, eyes open.',
      'Frame 3: same stance and body placement, a soft blink, shoulders settling.',
      'Frame 4: same stance and body placement, eyes open again, a tiny friendly head tilt returning toward frame 1.',
    ].join('\n'),
  },
  {
    state: 'working',
    direction: [
      'Create a seamless focused working loop. Keep the same compact matte-black director clapperboard in his left hand in all four frames.',
      'Frame 1: alert stance, looking at the clapperboard, right hand ready above it.',
      'Frame 2: right index finger makes one small tap on the clapperboard, cyan indicator softly lit.',
      'Frame 3: same stance, eyes briefly blink while the right hand withdraws slightly.',
      'Frame 4: eyes open, right hand returns to the ready position so the loop reconnects to frame 1.',
    ].join('\n'),
  },
  {
    state: 'peek',
    direction: [
      'Create a seamless sideways wall-peek loop. The wall is imaginary and must not be drawn.',
      'In every frame, shift his torso, hips, and legs into the left half of the quadrant while he leans his head and shoulders far into the right half. His full head, both eyes, and one hand must remain clearly visible inside the rightmost 45 percent of the quadrant so the web viewport can crop away the left 55 percent and still show a recognizable head peeking around its edge.',
      'Frame 1: cautious curious peek, eyes open, one hand lightly gripping the imaginary edge near his cheek.',
      'Frame 2: identical placement, eyes glance slightly farther into the screen.',
      'Frame 3: identical placement, a quick soft blink.',
      'Frame 4: eyes reopen with a tiny caught-in-the-act smile, returning cleanly to frame 1.',
    ].join('\n'),
  },
  {
    state: 'playful',
    direction: [
      'Create one short playful comedy loop. Keep the character centered with the same scale and foot baseline in all four frames so playback never jitters.',
      'Frame 1: a compact anticipatory crouch, shoulders raised, both fists near the chest, cheeks puffed, mischievous eyes.',
      'Frame 2: the action peak, a tiny vertical hop, hair tips lifted, both open hands beside his cheeks, one eye winking and the tip of his tongue showing in a friendly silly face.',
      'Frame 3: landing squash, knees bent and coat hem settling, surprised wide eyes and a tiny round mouth.',
      'Frame 4: back at the original baseline with a small sideways head tilt, one hand making a restrained peace sign and a caught-in-the-act grin, ready to return to the normal idle pose.',
    ].join('\n'),
  },
  {
    state: 'idea',
    direction: [
      'Create a short four-frame good-idea reaction. Keep the character centered with the same scale, foot baseline, and body proportions in every frame.',
      'Frame 1: relaxed thinking pose, one hand at his chin, eyes looking slightly upward, no extra object yet.',
      'Frame 2: his eyes brighten as one small cyan-white idea spark appears above and beside his head; the spark must not overlap his hair.',
      'Frame 3: delighted realization, one index finger raised, a compact glowing light-bulb symbol above the fingertip, excited open eyes and a clear smile.',
      'Frame 4: confident satisfied grin, holding one blank matte-black storyboard card with a cyan image-frame outline; no writing or symbols on the card, returning toward the neutral baseline.',
    ].join('\n'),
  },
  {
    state: 'gacha',
    direction: [
      'Create a fast comedic image-card gacha animation. Keep the character centered with the same scale, foot baseline, and body proportions in every frame.',
      'Use the same small matte-black image-card dispenser with restrained cyan light in all four frames. Every card must be blank visual artwork with no letters or readable UI.',
      'Frame 1: determined stance, both hands gripping the compact dispenser, eyes focused and ready.',
      'Frame 2: rapid draw action, one hand pulling a single glowing image card upward, coat sleeves and hair reacting only slightly.',
      'Frame 3: jackpot peak, three blank image cards fan around his shoulders while his eyes are wide and sparkling; energetic but keep every limb anatomically correct.',
      'Frame 4: delighted and slightly exhausted, hugging a tidy stack of image cards with a triumphant grin, feet back on the original baseline.',
    ].join('\n'),
  },
  {
    state: 'gaming',
    direction: [
      'Create a short playful gaming animation. Keep the character centered with the same scale, foot baseline, and body proportions in every frame.',
      'Use the exact same compact matte-black handheld game controller with two cyan thumb controls in all four frames. The controller has no logo, text, screen, or readable UI.',
      'Frame 1: focused gaming stance, controller held naturally in both hands near the waist, eyes fixed on an imaginary screen ahead.',
      'Frame 2: intense button-mashing moment, thumbs moving, brows focused, torso leaning forward only slightly.',
      'Frame 3: quick dodge reaction, shoulders and controller tilt together to one side while both feet stay planted at the same baseline.',
      'Frame 4: small victory celebration, one fist lifted beside his cheek while the other hand still holds the same controller, bright grin and happy eyes.',
    ].join('\n'),
  },
]

const selectedSpecs = requestedStates
  ? sheetSpecs.filter((spec) => requestedStates.has(spec.state))
  : sheetSpecs

if (requestedStates) {
  const knownStates = new Set(sheetSpecs.map((spec) => spec.state))
  const unknownStates = [...requestedStates].filter((state) => !knownStates.has(state))
  if (unknownStates.length > 0) {
    throw new Error(`Unknown director pet states: ${unknownStates.join(', ')}`)
  }
  if (selectedSpecs.length === 0) throw new Error('No director pet states selected')
}

async function uploadBytes(objectKey, body, contentType) {
  const providerKey = toHostedAssetKey(storage.provider, objectKey)
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: providerKey,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return buildObjectStorageUrl(storage.publicBase, providerKey)
}

async function ensureReferenceUrl() {
  const referenceKey = `static/team/xiaot-pet/reference-${assetVersion}.png`
  return uploadBytes(referenceKey, fs.readFileSync(sourcePortraitPath), 'image/png')
}

async function generateSheet(spec, referenceUrl) {
  const response = await fetch(`${newApiBase}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${newApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: `${sharedDirection}\n${spec.direction}`,
      images: [referenceUrl],
      n: 1,
      size: '2048x2048',
      quality: 'high',
      response_format: 'url',
      user: 'tapcanvas-director-pet',
    }),
    signal: AbortSignal.timeout(240_000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${spec.state} generation failed [${response.status}]: ${detail.slice(0, 300)}`)
  }

  const payload = await response.json()
  const item = payload?.data?.[0]
  if (typeof item?.url === 'string' && item.url) {
    const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(90_000) })
    if (!imageResponse.ok) throw new Error(`${spec.state} sheet download failed [${imageResponse.status}]`)
    return Buffer.from(await imageResponse.arrayBuffer())
  }
  if (typeof item?.b64_json === 'string' && item.b64_json) {
    return Buffer.from(item.b64_json, 'base64')
  }
  throw new Error(`${spec.state} response did not include an image URL or base64 payload`)
}

function removeChromaKey(sourcePath, outputPath) {
  execFileSync('python3', [
    chromaRemovalScript,
    '--input', sourcePath,
    '--out', outputPath,
    '--auto-key', 'border',
    '--soft-matte',
    '--transparent-threshold', '12',
    '--opaque-threshold', '220',
    '--despill',
    '--force',
  ], { stdio: 'inherit' })
}

function cropFrames(state, transparentSheetPath) {
  execFileSync('python3', [
    sheetProcessingScript,
    '--input', transparentSheetPath,
    '--out-dir', outputDir,
    '--state', state,
  ], { stdio: 'inherit' })
  return [1, 2, 3, 4].map((index) => (
    path.join(outputDir, `${state}-${String(index).padStart(2, '0')}.png`)
  ))
}

function validateFrame(framePath) {
  const output = execFileSync('sips', ['--getProperty', 'pixelWidth', '--getProperty', 'pixelHeight', '--getProperty', 'hasAlpha', framePath], { encoding: 'utf8' })
  if (!output.includes('pixelWidth: 512') || !output.includes('pixelHeight: 512') || !output.includes('hasAlpha: yes')) {
    throw new Error(`Frame validation failed: ${framePath}\n${output}`)
  }
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true })
  const referenceUrl = await ensureReferenceUrl()
  const manifest = {}

  for (const spec of selectedSpecs) {
    console.log(`Generating ${spec.state} sheet...`)
    const sourcePath = path.join(outputDir, `${spec.state}-sheet-source.png`)
    const transparentPath = path.join(outputDir, `${spec.state}-sheet-transparent.png`)
    if (!reuseExisting || !fs.existsSync(sourcePath)) {
      fs.writeFileSync(sourcePath, await generateSheet(spec, referenceUrl))
    } else {
      console.log(`Reusing ${sourcePath}`)
    }
    removeChromaKey(sourcePath, transparentPath)
    const frames = cropFrames(spec.state, transparentPath)
    manifest[spec.state] = []
    for (let index = 0; index < frames.length; index += 1) {
      const framePath = frames[index]
      validateFrame(framePath)
      const key = `static/team/xiaot-pet/${spec.state}-${String(index + 1).padStart(2, '0')}-${assetVersion}.png`
      const url = await uploadBytes(key, fs.readFileSync(framePath), 'image/png')
      manifest[spec.state].push(url)
      console.log(`${spec.state}-${index + 1}: ${url}`)
    }
  }

  const manifestPath = path.join(outputDir, 'manifest.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Manifest: ${manifestPath}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
