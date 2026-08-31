#!/usr/bin/env node

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

const SOURCE_PREFIXES = [
  'static/portal/',
  'tapcanvas/lighting-presets/',
  'gen/camera-icons/',
  'static/team/xiaot-pet/',
  'assets/onboarding/',
  'assets/skill-marketplace/20260722-v2/',
  'uploads/user/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20260510/',
  'gen/images/18146279/20260715/',
  'gen/videos/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20260521/',
  'ui/icons/',
]

const DESTINATION_PREFIX = 'tapcanvas/legacy/'

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function createClient(input) {
  return new S3Client({
    region: input.region,
    endpoint: input.endpoint,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
    forcePathStyle: false,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

async function listKeys(client, bucket, prefix) {
  const keys = []
  let continuationToken
  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }))
    for (const item of result.Contents ?? []) {
      if (item.Key) keys.push(item.Key)
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined
    if (result.IsTruncated && !continuationToken) {
      throw new Error(`Source listing truncated without continuation token: ${prefix}`)
    }
  } while (continuationToken)
  return keys
}

async function assertDestinationMissing(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return
    throw error
  }
  throw new Error(`Refusing to overwrite existing TOS object: ${key}`)
}

const sourceEndpoint = requireEnv('SOURCE_R2_ENDPOINT_URL')
const sourceBucket = requireEnv('SOURCE_R2_BUCKET')
const destinationEndpoint = requireEnv('TOS_ENDPOINT_URL')
const destinationBucket = requireEnv('TOS_BUCKET')
const destinationPublicBase = requireEnv('TOS_PUBLIC_BASE_URL').replace(/\/+$/, '')

const sourceClient = createClient({
  endpoint: sourceEndpoint,
  region: requireEnv('SOURCE_R2_REGION'),
  accessKeyId: requireEnv('SOURCE_R2_ACCESS_KEY_ID'),
  secretAccessKey: requireEnv('SOURCE_R2_SECRET_ACCESS_KEY'),
})
const destinationClient = createClient({
  endpoint: destinationEndpoint,
  region: requireEnv('TOS_REGION'),
  accessKeyId: requireEnv('TOS_ACCESS_KEY_ID'),
  secretAccessKey: requireEnv('TOS_SECRET_ACCESS_KEY'),
})

const sourceKeys = [...new Set((await Promise.all(
  SOURCE_PREFIXES.map((prefix) => listKeys(sourceClient, sourceBucket, prefix)),
)).flat())].sort()

if (sourceKeys.length === 0) throw new Error('No source runtime assets found')

for (const sourceKey of sourceKeys) {
  await assertDestinationMissing(
    destinationClient,
    destinationBucket,
    `${DESTINATION_PREFIX}${sourceKey}`,
  )
}

for (const sourceKey of sourceKeys) {
  const destinationKey = `${DESTINATION_PREFIX}${sourceKey}`
  const source = await sourceClient.send(new GetObjectCommand({
    Bucket: sourceBucket,
    Key: sourceKey,
  }))
  if (!source.Body) throw new Error(`Source object has no body: ${sourceKey}`)

  await destinationClient.send(new PutObjectCommand({
    Bucket: destinationBucket,
    Key: destinationKey,
    Body: source.Body,
    ContentLength: source.ContentLength,
    ContentType: source.ContentType,
    CacheControl: source.CacheControl || 'public, max-age=31536000, immutable',
    ContentDisposition: source.ContentDisposition,
    ContentEncoding: source.ContentEncoding,
    Metadata: source.Metadata,
  }))

  const uploaded = await destinationClient.send(new HeadObjectCommand({
    Bucket: destinationBucket,
    Key: destinationKey,
  }))
  if (source.ContentLength !== undefined && uploaded.ContentLength !== source.ContentLength) {
    throw new Error(`TOS size mismatch for ${destinationKey}: expected ${source.ContentLength}, received ${uploaded.ContentLength}`)
  }
  console.log(`${destinationPublicBase}/${destinationKey}`)
}

console.log(JSON.stringify({ migrated: sourceKeys.length, destinationPrefix: DESTINATION_PREFIX }))
