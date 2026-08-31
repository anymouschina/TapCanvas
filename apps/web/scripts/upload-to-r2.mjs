// 一次性脚本：将 apimart 生成的图片上传到显式选择的对象存储。
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import {
  buildObjectStorageUrl,
  resolveObjectStorageTarget,
  toHostedAssetKey,
} from '../../hono-api/scripts/object-storage-config.mjs'

const require = createRequire(new URL('../../hono-api/package.json', import.meta.url))
// 使用 hono-api 的 node_modules
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const storage = resolveObjectStorageTarget()
const s3 = new S3Client(storage.s3ClientConfig)

const IMAGES = {
  wizard_step1: 'https://upload.apimart.ai/f/image/9998221576855940-a20c573d-c116-42a7-9c1e-5e127ee67e75-gpt_image_2_backup_task_01KR94F7KTK35R8RTDDBGNM0YY_0.png',
  wizard_step2: 'https://upload.apimart.ai/f/image/9998221576789559-0a86aa2f-d3d7-4556-96a7-3e4d497cc21e-gpt_image_2_backup_task_01KR94H8E6MG6PWSSYHQNG80BC_0.png',
  wizard_step3: 'https://upload.apimart.ai/f/image/9998221576733617-1ae1fb92-d1e7-4a4e-b25f-f7c057ea454b-gpt_image_2_backup_task_01KR94JZ2CST27B8P9VJ4AAX00_0.png',
  wizard_step4: 'https://upload.apimart.ai/f/image/9998221576675135-017dd761-2ee3-4afd-9b8f-d1cb2eeace65-gpt_image_2_backup_task_01KR94MR5ZSQ2EB8VM5SP1W2V4_0.png',
  cover_storyboard_guide: 'https://upload.apimart.ai/f/image/9998221576605672-1680f02e-212a-417d-ad9b-9cf1566e0864-gpt_image_2_backup_task_01KR94PW0P9YGEXC28DNW2BQJ3_0.png',
  cover_scene_image: 'https://upload.apimart.ai/f/image/9998221576555200-630c8a0d-0891-4504-bcd1-200d0de114a7-gpt_image_2_backup_task_01KR94RD9YPWFNHNHH4H1Z436B_0.png',
  cover_image_to_video: 'https://upload.apimart.ai/f/image/9998221576513092-46ca8724-1806-4afc-97b6-f27af55d64f3-gpt_image_2_backup_task_01KR94SPDTMB2Y8QJ7CWSFEZMB_0.png',
  cover_storyboard_sequence: 'https://upload.apimart.ai/f/image/9998221576463922-ec767e76-5ea7-4260-807f-0a8bd253329b-gpt_image_2_backup_task_01KR94V6EBVWH22N37NMKMXNJ6_0.png',
}

async function downloadAndUpload(key, url) {
  console.log(`处理 [${key}]...`)

  // 下载图片
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`下载失败 ${resp.status}: ${url}`)
  const buffer = await resp.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  const objectKey = toHostedAssetKey(storage.provider, `assets/onboarding/${key}-${Date.now()}.png`)

  await s3.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
    Body: bytes,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  const objectUrl = buildObjectStorageUrl(storage.publicBase, objectKey)
  console.log(`  OK: ${objectUrl}`)
  return objectUrl
}

async function run() {
  const results = {}
  for (const [key, url] of Object.entries(IMAGES)) {
    results[key] = await downloadAndUpload(key, url)
  }
  console.log(`\n=== ${storage.provider.toUpperCase()} URL 结果 ===`)
  console.log(JSON.stringify(results, null, 2))
  await writeFile('/tmp/onboarding-object-storage-urls.json', JSON.stringify(results, null, 2))
  console.log('\n结果已保存到 /tmp/onboarding-object-storage-urls.json')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
