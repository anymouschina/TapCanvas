// 一次性脚本：调 gpt-image-2 生成向导样图
import { writeFileSync } from 'node:fs'

const NEW_API_BASE = 'http://localhost:4455'
const NEW_API_TOKEN = 'sk-1p7HiBCeJrhefhfT3MWWpL8o8ZaKTB0aoDCQClfn6IIx0dVz'

const PROMPTS = {
  wizard_step1: 'Dark cinematic UI screenshot showing a text editor with story script text glowing, film production software interface, professional dark theme, screenplay text visible on screen',
  wizard_step2: 'Dark UI showing a grid of scene cards and character portrait cards, film storyboard production software, cinematic thumbnails with noir atmosphere, clean modern dark interface design',
  wizard_step3: 'Storyboard grid layout with 4 cinematic panels, noir detective story, dark moody atmosphere, night street scene, rain wet pavement reflections, close-up dramatic face, professional film production storyboard',
  wizard_step4: 'High quality cinematic storyboard artwork 4 panels refined by AI, noir mystery story, dramatic chiaroscuro lighting, professional film illustration quality, polished production art',
  cover_storyboard_guide: 'Cinematic film storyboard panels montage wide format, dark dramatic atmosphere, noir story, professional production art horizontal composition',
  cover_scene_image: 'Single dramatic movie scene golden hour backlight, silhouette figure on city bridge, cinematic widescreen composition, film still quality',
  cover_image_to_video: 'Film key frame to motion sequence, dynamic movement blur, neon city night, cinematic widescreen',
  cover_storyboard_sequence: 'Script pages with pencil storyboard sketches overlay, director planning board, dark moody dramatic lighting, film production',
}

async function generateImage(key, prompt) {
  console.log(`生成 [${key}]...`)
  const resp = await fetch(`${NEW_API_BASE}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NEW_API_TOKEN}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      response_format: 'url',
    }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.error(`  失败 [${key}] (${resp.status}): ${text.slice(0, 200)}`)
    return null
  }
  const data = await resp.json()
  const url = data?.data?.[0]?.url
  if (!url) { console.error(`  无 URL [${key}]`, JSON.stringify(data).slice(0, 300)); return null }
  console.log(`  OK [${key}]: ${url}`)
  return url
}

async function run() {
  const results = {}
  for (const [key, prompt] of Object.entries(PROMPTS)) {
    results[key] = await generateImage(key, prompt)
  }
  console.log('\n=== 完整结果 ===')
  console.log(JSON.stringify(results, null, 2))
  writeFileSync('/tmp/onboarding-images-result.json', JSON.stringify(results, null, 2))
  console.log('\n结果已保存到 /tmp/onboarding-images-result.json')
}

run().catch(console.error)
