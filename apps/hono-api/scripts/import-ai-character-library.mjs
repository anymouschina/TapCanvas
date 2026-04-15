const apiBase = String(process.env.TAPCANVAS_LOCAL_API_BASE || 'http://localhost:8788').trim().replace(/\/+$/, '')
const localAuthToken = String(process.env.TAPCANVAS_LOCAL_AUTH_TOKEN || '').trim()
const tapNowAuthorization = String(process.env.TAPNOW_AUTHORIZATION || '').trim()
const tapNowDeviceId = String(process.env.TAPNOW_DEVICE_ID || '').trim()
const tapNowTimezone = String(process.env.TAPNOW_TIMEZONE || 'Asia/Shanghai').trim()
const tapNowUserLang = String(process.env.TAPNOW_USER_LANG || 'zh-CN').trim()
const tapNowBrowserLocale = String(process.env.TAPNOW_BROWSER_LOCALE || tapNowUserLang || 'zh-CN').trim()
const projectId = String(process.env.TAPCANVAS_PROJECT_ID || '').trim()

function fail(message) {
  console.error(`[import-ai-character-library] ${message}`)
  process.exit(1)
}

if (!localAuthToken) fail('missing TAPCANVAS_LOCAL_AUTH_TOKEN')
if (!tapNowAuthorization) fail('missing TAPNOW_AUTHORIZATION')
if (!tapNowDeviceId) fail('missing TAPNOW_DEVICE_ID')

async function requestJson(url, init) {
  const response = await fetch(url, init)
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    const msg =
      (payload && typeof payload === 'object' && (payload.error || payload.message))
        ? String(payload.error || payload.message)
        : `HTTP ${response.status}`
    throw new Error(`${msg}${text && !payload ? `: ${text.slice(0, 400)}` : ''}`)
  }
  return payload
}

async function main() {
  const importPayload = {
    ...(projectId ? { projectId } : {}),
    sourceAuthorization: tapNowAuthorization,
    sourceDeviceId: tapNowDeviceId,
    sourceTimezone: tapNowTimezone,
    sourceLanguage: tapNowUserLang,
    sourceBrowserLocale: tapNowBrowserLocale,
  }

  const importResult = await requestJson(`${apiBase}/assets/character-library/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localAuthToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(importPayload),
  })

  const listQuery = new URLSearchParams()
  listQuery.set('offset', '0')
  listQuery.set('limit', '5')
  if (projectId) listQuery.set('projectId', projectId)

  const listResult = await requestJson(`${apiBase}/assets/character-library/characters?${listQuery.toString()}`, {
    headers: {
      Authorization: `Bearer ${localAuthToken}`,
    },
  })

  const sampleCharacters = Array.isArray(listResult?.characters)
    ? listResult.characters.slice(0, 5).map((item) => ({
        id: item.id,
        name: item.identity_hint || item.character_id || item.id,
        worldview: item.filter_worldview || '',
        theme: item.filter_theme || '',
      }))
    : []

  console.log(JSON.stringify({
    ok: true,
    importResult,
    syncState: listResult?.syncState || null,
    sampleCharacters,
  }, null, 2))
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'unknown import failure')
})
