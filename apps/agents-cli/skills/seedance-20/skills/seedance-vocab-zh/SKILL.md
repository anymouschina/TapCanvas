---
name: seedance-vocab-zh
description: "This skill should be used when the user asks for Chinese Seedance 2.0 prompt wording, Mandarin cinematic vocabulary, Chinese prompt compression, or translation of camera, lighting, action, VFX, audio, and production terms into Chinese."
license: MIT
user-invocable: true
tags:
  - chinese
  - vocabulary
  - seedance-20
metadata:
  version: "6.6.0"
  updated: "2026-07-04"
  parent: "seedance-20"
  author: "Iamemily2050 (@iamemily2050)"
  repository: "https://github.com/Emily2040/seedance-2.0"
  openclaw:
    emoji: "🎬"
    homepage: "https://github.com/Emily2040/seedance-2.0"
---

# seedance-vocab-zh

Use Chinese vocabulary when the user asks for Chinese prompts, Mandarin cinematic wording, role binding, first/last-frame workflow, or maximum compactness. Chinese prompt wording is often efficient, but it must still preserve mode, reference roles, action, camera, lighting, audio, and constraints.

## Intent

Chinese can say in four characters what English needs a sentence for - and the user choosing Chinese is choosing that compression and its culture. Serve the density without losing the directing: every 成语-tight phrase still names something a camera can see.

## Usage Rule

Literal `@Image1`, `@Video1`, `@Audio1`, `@图片1`, `@视频1`, and `@音频1` strings below are Seedance 2.0 surface examples. Preserve an exact tag only when the user or active surface supplied it. For Seedance 2.5 without token mapping, use neutral asset-role names in the prompt plan and bind execution through the structured reference fields; never invent or translate a tag. Use short production phrases instead of abstract adjectives.

Load `[ref:vocab/zh]` for dense role-binding, first/last-frame, camera, lighting, audio, edit/extend, constraint, and safety vocabulary.

| Function | Chinese wording |
|---|---|
| Camera | `缓慢推镜`, `横向跟拍`, `固定中景`, `低角度`, `特写`, `从剪影到正面四分之三角度` |
| Lighting | `侧逆光`, `柔和窗光`, `暖色实用灯`, `冷色月光`, `轮廓光`, `体积光` |
| Motion | `慢慢转身`, `快速掠过画面`, `水珠沿表面下滑`, `薄雾贴地扩散` |
| Audio | `安静环境声`, `一句短对白`, `轻微金属声`, `无配乐`, `脚步声卡点` |
| First/last frame | `[活动 surface 的精确首帧引用] 为首帧`, `[活动 surface 的精确尾帧引用] 为尾帧`, `自然过渡到尾帧`, `中间动作连续，不跳切` |
| Constraints | `严格保持logo、标签、形状和颜色不变` |

## Compact Pattern

`[活动 surface 提供的精确图像引用 token，或中性资产名]为参考，严格保持[主体/产品/脸部/标志]不变；仅加入[动作/光线/镜头变化]。镜头：[一个动作]。声音：[音效或环境声]。`

## De-Slop Rule

When the prompt leans on `电影感`, `氛围感`, `高级感`, `大片感`, or bare `质感`, load the Slop Traps table in `references/vocab/zh.md` and decompose each into the physical elements that produce it - 材质, 光线, 色彩, 空气.

## Output Contract

Return concise Chinese prompt text, optional English gloss when useful, and preserve reference tags exactly.
