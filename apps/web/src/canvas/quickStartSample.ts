import type { Edge, Node } from '@xyflow/react'

const flow: { nodes: Node[]; edges: Edge[] } = {
  nodes: [
    {
      id: '92f97b34-4626-449c-bf58-881c8426356f',
      type: 'taskNode',
      position: { x: 160, y: 144 },
      data: {
        kind: 'image',
        logs: [
          '[15:09:30] queued (AI, text_to_image)',
          '[15:09:30] 调用Qwen 图像模型 …',
          '[15:09:39] 文案模型调用成功',
          '[15:11:29] queued (AI, text_to_image)',
          '[15:11:29] 调用Qwen 图像模型 …',
          '[15:11:38] 文案模型调用成功',
        ],
        label: 'Anime Style Selfie',
        prompt:
          'Anime transformation of a close-up vertical selfie featuring a young East Asian woman with straight chestnut-brown hair, soft blush makeup, glossy pink lips, and a ribbed dark brown cutout sweater revealing cleavage. Place her outdoors in a modern Tokyo street filled with mid-rise buildings, signage, and a pastel sky, rendered with a fresh anime aesthetic. Slight downward angle from a smartphone front camera, natural midday sunlight for warm highlights, shallow depth of field with bokeh, and adjust her pose to a more dynamic anime gesture with a playful hand near her face.',
        status: 'success',
        canceled: false,
        imageUrl:
          'https://dashscope-result-wlcb-acdr-1.oss-cn-wulanchabu-acdr-1.aliyuncs.com/7d/59/20251127/cfc32567/568e9755-0123-433f-80ac-d8e2516d386f-1.png?Expires=1764833177&OSSAccessKeyId=LTAI5tKPD3TMqf2Lna1fASuh&Signature=Pnns8ouryHvqzbt6rqH5C2goZ3A%3D',
        progress: 100,
        lastResult: {
          at: 1764227498474,
          id: 'fd2b8e87-5075-442a-9a04-b480bd693c8a',
          kind: 'image',
          preview: {
            src: 'https://dashscope-result-wlcb-acdr-1.oss-cn-wulanchabu-acdr-1.aliyuncs.com/7d/49/20251127/cfc32567/197f4849-a986-4143-b44a-75c4764e4fcc-1.png?Expires=1764833297&OSSAccessKeyId=LTAI5tKPD3TMqf2Lna1fASuh&Signature=qeLcCp%2B76ONdlsOIMy6eGzsTdLY%3D',
            type: 'image',
          },
        },
        imageResults: [
          {
            url: 'https://dashscope-result-wlcb-acdr-1.oss-cn-wulanchabu-acdr-1.aliyuncs.com/7d/59/20251127/cfc32567/568e9755-0123-433f-80ac-d8e2516d386f-1.png?Expires=1764833177&OSSAccessKeyId=LTAI5tKPD3TMqf2Lna1fASuh&Signature=Pnns8ouryHvqzbt6rqH5C2goZ3A%3D',
          },
          {
            url: 'https://dashscope-result-wlcb-acdr-1.oss-cn-wulanchabu-acdr-1.aliyuncs.com/7d/49/20251127/cfc32567/197f4849-a986-4143-b44a-75c4764e4fcc-1.png?Expires=1764833297&OSSAccessKeyId=LTAI5tKPD3TMqf2Lna1fASuh&Signature=qeLcCp%2B76ONdlsOIMy6eGzsTdLY%3D',
          },
        ],
        negativePrompt:
          'low detail, distorted anatomy, messy background, dull colors, exaggerated expression, grainy texture, blurred face, extra limbs, incorrect pose',
      },
    },
    {
      id: '0010103f-5932-44d2-a45c-6ae33f35447d',
      type: 'taskNode',
      position: { x: 624, y: 128 },
      data: {
        kind: 'composeVideo',
        logs: [
          '[15:11:38] queued (AI, text_to_video)',
          '[15:11:38] 调用 Sora-2 生成视频任务…',
          '[15:11:52] Sora 视频任务创建完成（ID: task_01kb22ex86f3mvg6r3kx8ptdnz），开始轮询进度…',
          '[15:11:54] Sora 视频任务排队中（位置：未知）',
          '[15:12:04] error: 在所有 1 个 Sora 账号的草稿中都未找到对应视频，请确认任务ID是否正确或稍后再试',
          '[15:12:08] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:12] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:16] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:22] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:26] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:29] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:33] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:37] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:41] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:44] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:49] Sora 视频任务排队中（位置：未知，进度：9%）',
          '[15:12:53] Sora 视频任务排队中（位置：未知，进度：36%）',
          '[15:12:57] Sora 视频任务排队中（位置：未知，进度：36%）',
          '[15:13:01] Sora 视频任务排队中（位置：未知，进度：44%）',
          '[15:13:05] Sora 视频任务排队中（位置：未知，进度：44%）',
          '[15:13:09] Sora 视频任务排队中（位置：未知，进度：44%）',
          '[15:13:13] Sora 视频任务排队中（位置：未知，进度：52%）',
          '[15:13:17] Sora 视频任务排队中（位置：未知，进度：52%）',
          '[15:13:21] Sora 视频任务排队中（位置：未知，进度：59%）',
          '[15:13:25] Sora 视频任务排队中（位置：未知，进度：59%）',
          '[15:13:29] Sora 视频任务排队中（位置：未知，进度：59%）',
          '[15:13:33] Sora 视频任务排队中（位置：未知，进度：67%）',
          '[15:13:37] Sora 视频任务排队中（位置：未知，进度：67%）',
          '[15:13:41] Sora 视频任务排队中（位置：未知，进度：67%）',
          '[15:13:45] Sora 视频任务排队中（位置：未知，进度：73%）',
          '[15:13:49] Sora 视频任务排队中（位置：未知，进度：73%）',
          '[15:13:52] Sora 视频任务排队中（位置：未知，进度：79%）',
          '[15:13:57] Sora 视频任务排队中（位置：未知，进度：79%）',
          '[15:14:01] Sora 视频任务排队中（位置：未知，进度：79%）',
          '[15:14:04] Sora 视频任务排队中（位置：未知，进度：80%）',
          '[15:14:08] Sora 视频任务排队中（位置：未知，进度：80%）',
          '[15:14:12] Sora 视频任务排队中（位置：未知，进度：80%）',
          '[15:14:16] Sora 视频任务排队中（位置：未知，进度：80%）',
          '[15:14:19] Sora 视频任务排队中（位置：未知，进度：92%）',
          '[15:14:23] Sora 视频任务排队中（位置：未知，进度：94%）',
          '[15:14:27] Sora 视频任务排队中（位置：未知，进度：95%）',
          '[15:14:31] Sora 视频任务排队中（位置：未知，进度：97%）',
          '[15:14:34] Sora 视频任务排队中（位置：未知，进度：97%）',
          '[15:14:38] Sora 视频任务排队中（位置：未知，进度：98%）',
          '[15:14:42] pending列表为空，尝试同步草稿检查任务状态...',
          '[15:14:49] 已从草稿同步生成的视频（task_id=task_01kb22ex86f3mvg6r3kx8ptdnz），可预览。',
          '[15:14:49] 草稿同步成功，任务已完成！',
          '[15:14:49] 已停止轮询 Sora 视频任务进度，请在 Sora 控制台继续查看后续状态。',
        ],
        label: 'Anime Cinematic Sequence',
        prompt:
          'Cinematic anime sequence set in a stylized modern Tokyo dusk. The protagonist, the same young East Asian woman from the previous selfie, now moves in a fluid storyboard: she finishes her selfie pose, tucks her phone into a small crossbody bag, and steps into a neon-lit avenue. Camera tracks her from shoulder to waist, then swings to a wide shot revealing animated signage, drifting sakura petals, and layered reflections on wet pavement. She spots a rooftop cafe sign and sprints up a textured stairwell; subtle motion blur and dynamic lighting accentuate her movements. Upon reaching the rooftop, a soft breeze lifts her chestnut-brown hair as she gazes over the skyline, revealing background holograms and sky trains gliding overhead. Her ribbed cutout sweater and layered accessories react to physics: fabric folds, hair strands, and jewelry all respond naturally to motion and wind. She tilts the camera for a final playful selfie framing Tokyo Tower in the distance as the sun sets, ending with a gentle focus rack to the background. Emphasize cinematic pacing, rich parallax, and believable anime physics in every scene transition.',
        status: 'success',
        canceled: false,
        keywords: 'anime cinematic, Tokyo dusk, dynamic camera, rooftop chase, realistic physics',
        progress: 100,
        videoUrl:
          'https://videos.beqlee.icu/az/files/00000000-f860-7280-bb0a-b4ebf92a8a43%2Fraw?se=2025-12-02T00%3A00%3A00Z&sp=r&sv=2024-08-04&sr=b&skoid=8ffff87a-01f1-47c9-9090-32999d4d6380&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2025-11-27T01%3A07%3A50Z&ske=2025-12-04T01%3A12%3A50Z&sks=b&skv=2024-08-04&sig=yyJ9L79jSe2xqXxpxhBZ6yIlfvBTVdy7iSoZ4s1CA3U%3D&ac=oaisdsorprsouthcentralus',
        lastResult: {
          at: 1764227689353,
          id: 'task_01kb22ex86f3mvg6r3kx8ptdnz',
          kind: 'composeVideo',
          preview: {
            src: 'https://videos.beqlee.icu/az/files/00000000-f860-7280-bb0a-b4ebf92a8a43%2Fraw?se=2025-12-02T00%3A00%3A00Z&sp=r&sv=2024-08-04&sr=b&skoid=8ffff87a-01f1-47c9-9090-32999d4d6380&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2025-11-27T01%3A07%3A50Z&ske=2025-12-04T01%3A12%3A50Z&sks=b&skv=2024-08-04&sig=yyJ9L79jSe2xqXxpxhBZ6yIlfvBTVdy7iSoZ4s1CA3U%3D&ac=oaisdsorprsouthcentralus',
            type: 'video',
          },
        },
        videoModel: 'sora-2',
        videoTitle: null,
        videoPostId: null,
        videoPrompt:
          'Anime transformation of a close-up vertical selfie featuring a young East Asian woman with straight chestnut-brown hair, soft blush makeup, glossy pink lips, and a ribbed dark brown cutout sweater revealing cleavage. Place her outdoors in a modern Tokyo street filled with mid-rise buildings, signage, and a pastel sky, rendered with a fresh anime aesthetic. Slight downward angle from a smartphone front camera, natural midday sunlight for warm highlights, shallow depth of field with bokeh, and adjust her pose to a more dynamic anime gesture with a playful hand near her face.\nCinematic anime sequence set in a stylized modern Tokyo dusk. The protagonist, the same young East Asian woman from the previous selfie, now moves in a fluid storyboard: she finishes her selfie pose, tucks her phone into a small crossbody bag, and steps into a neon-lit avenue. Camera tracks her from shoulder to waist, then swings to a wide shot revealing animated signage, drifting sakura petals, and layered reflections on wet pavement. She spots a rooftop cafe sign and sprints up a textured stairwell; subtle motion blur and dynamic lighting accentuate her movements. Upon reaching the rooftop, a soft breeze lifts her chestnut-brown hair as she gazes over the skyline, revealing background holograms and sky trains gliding overhead. Her ribbed cutout sweater and layered accessories react to physics: fabric folds, hair strands, and jewelry all respond naturally to motion and wind. She tilts the camera for a final playful selfie framing Tokyo Tower in the distance as the sun sets, ending with a gentle focus rack to the background. Emphasize cinematic pacing, rich parallax, and believable anime physics in every scene transition.',
        videoTaskId: 'task_01kb22ex86f3mvg6r3kx8ptdnz',
        videoDraftId: 'gen_01kb22kcatek2bx78krepk4eh9',
        videoResults: [
          {
            id: 'gen_01kb22kcatek2bx78krepk4eh9',
            url: 'https://videos.beqlee.icu/az/files/00000000-f860-7280-bb0a-b4ebf92a8a43%2Fraw?se=2025-12-02T00%3A00%3A00Z&sp=r&sv=2024-08-04&sr=b&skoid=8ffff87a-01f1-47c9-9090-32999d4d6380&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2025-11-27T01%3A07%3A50Z&ske=2025-12-04T01%3A12%3A50Z&sks=b&skv=2024-08-04&sig=yyJ9L79jSe2xqXxpxhBZ6yIlfvBTVdy7iSoZ4s1CA3U%3D&ac=oaisdsorprsouthcentralus',
            model: 'sy_8',
            title: null,
            duration: 10,
            thumbnailUrl:
              'https://videos.beqlee.icu/az/files/3506917c9d543a2_00000000-f860-7280-bb0a-b4ebf92a8a43%2Fdrvs%2Fthumbnail%2Fraw?se=2025-12-02T00%3A00%3A00Z&sp=r&sv=2024-08-04&sr=b&skoid=8ffff87a-01f1-47c9-9090-32999d4d6380&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2025-11-27T01%3A07%3A50Z&ske=2025-12-04T01%3A12%3A50Z&sks=b&skv=2024-08-04&sig=mAM1/afA%2Bwux%2BdcxwcetMFpo8CEUnlwEGD/Hny%2BGXAY%3D&ac=oaisdsorprsouthcentralus',
          },
        ],
        videoTokenId: '7115390c-1c56-4347-b81f-60e012ed6ffa',
        soraVideoTask: {
          id: 'task_01kb22ex86f3mvg6r3kx8ptdnz',
          priority: 1,
          __usedTokenId: '7115390c-1c56-4347-b81f-60e012ed6ffa',
          __tokenSwitched: false,
          __switchedFromTokenIds: [],
          rate_limit_and_credit_balance: {
            credit_remaining: 0,
            rate_limit_reached: false,
            access_resets_in_seconds: 11713,
            estimated_num_videos_remaining: 27,
            estimated_num_purchased_videos_remaining: 0,
          },
        },
        negativePrompt:
          'stiff animation, low detail, inconsistent character design, empty backgrounds, dull lighting, awkward camera movement, low resolution, glitch artifacts',
        videoOrientation: 'landscape',
        videoPrimaryIndex: 0,
        videoThumbnailUrl:
          'https://videos.beqlee.icu/az/files/3506917c9d543a2_00000000-f860-7280-bb0a-b4ebf92a8a43%2Fdrvs%2Fthumbnail%2Fraw?se=2025-12-02T00%3A00%3A00Z&sp=r&sv=2024-08-04&sr=b&skoid=8ffff87a-01f1-47c9-9090-32999d4d6380&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2025-11-27T01%3A07%3A50Z&ske=2025-12-04T01%3A12%3A50Z&sks=b&skv=2024-08-04&sig=mAM1/afA%2Bwux%2BdcxwcetMFpo8CEUnlwEGD/Hny%2BGXAY%3D&ac=oaisdsorprsouthcentralus',
        videoInpaintFileId: null,
        videoDurationSeconds: 15,
        geminiModel: 'sora-2',
        imageModel: 'sora-2',
      },
    },
  ],
  edges: [
    {
      id: 'reactflow__edge-92f97b34-4626-449c-bf58-881c8426356f-0010103f-5932-44d2-a45c-6ae33f35447d',
      type: 'smoothstep',
      source: '92f97b34-4626-449c-bf58-881c8426356f',
      target: '0010103f-5932-44d2-a45c-6ae33f35447d',
      animated: true,
    },
  ],
}

export function getQuickStartSampleFlow(): { nodes: Node[]; edges: Edge[] } {
  return JSON.parse(JSON.stringify(flow)) as { nodes: Node[]; edges: Edge[] }
}
