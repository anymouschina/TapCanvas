from __future__ import annotations

from typing import List

from agent.tools_and_schemas import PromptRequest, PromptResult


def _cn_prompt(req: PromptRequest) -> PromptResult:
    parts: List[str] = []
    aspects: List[str] = []
    notes: List[str] = []

    parts.append(req.subject.strip())
    if req.visual_style:
        parts.append(req.visual_style.strip())

    workflow = req.workflow
    if workflow == "character_creation":
        parts.extend(
            [
                "全身角色设定稿",
                "turnaround 多视角，姿态稳定",
                "清晰轮廓，便于跨镜头复现",
            ]
        )
        aspects.extend(
            [
                "保持服装/配件位置一致",
                "同一光照与背景，棚拍渐变底",
                "中焦镜头，避免夸张透视",
            ]
        )
        notes.append("推荐输出多视角（正面/3⁄4/侧面/背面），背景统一。")
    elif workflow == "direct_image":
        parts.extend(
            [
                "单镜头主视图",
                "主体居中，高清锐利",
                "干净背景（可渐变/虚化），突出主体",
            ]
        )
        aspects.append("相机中焦或轻微长焦，避免畸变；保持同一配色与材质。")
    elif workflow == "merchandise":
        parts.extend(
            [
                "产品/衍生品渲染",
                "干净电商/陈列背景",
                "光线均匀，材质质感清晰",
            ]
        )
        aspects.append("保持角色元素/标志物一致；背景简洁以突出产品。")

    if req.consistency:
        parts.append(f"一致性要求：{req.consistency.strip()}")

    if req.model:
        notes.append(f"模型提示：面向 {req.model}，保持分辨率与时长在可接受范围内。")

    parts.extend(
        [
            "高质量，清晰对焦，干净轮廓",
            "柔和主光 + rim light 勾勒边缘（若适用）",
        ]
    )

    prompt = "，".join([p for p in parts if p])

    negative_list = [
        "低清晰度，模糊，噪点，水印，文字，logo，畸变，肢体错位，解剖错误",
    ]
    if workflow == "character_creation":
        negative_list.append("夸张卡通比例，反派邪恶表情，杂乱背景")
    elif workflow == "direct_image":
        negative_list.append("杂乱场景，过曝或极暗，对比度过高")
    elif workflow == "merchandise":
        negative_list.append("杂乱陈列，背景文字，强阴影遮挡产品")

    negative_prompt = "，".join(negative_list)

    return PromptResult(
        workflow=workflow,
        prompt=prompt,
        negative_prompt=negative_prompt,
        suggested_aspects=aspects,
        notes=notes,
    )


def _en_prompt(req: PromptRequest) -> PromptResult:
    parts: List[str] = []
    aspects: List[str] = []
    notes: List[str] = []

    parts.append(req.subject.strip())
    if req.visual_style:
        parts.append(req.visual_style.strip())

    workflow = req.workflow
    if workflow == "character_creation":
        parts.extend(
            [
                "full-body character sheet",
                "turnaround multi-view, stable posture",
                "clean silhouette for cross-shot consistency",
            ]
        )
        aspects.extend(
            [
                "lock outfit/accessory placement",
                "same lighting and studio gradient background",
                "mid focal length, avoid distortion",
            ]
        )
        notes.append("Recommend exporting multiple views (front/3⁄4/side/back) with unified background.")
    elif workflow == "direct_image":
        parts.extend(
            [
                "single shot main view",
                "subject centered, crisp focus",
                "clean background (gradient or soft blur) to highlight subject",
            ]
        )
        aspects.append("Mid or slight tele focal length; keep palette/material consistent.")
    elif workflow == "merchandise":
        parts.extend(
            [
                "product/merch rendering",
                "clean e-commerce display background",
                "even lighting, clear material readability",
            ]
        )
        aspects.append("Preserve character motifs/logos; keep background minimal to highlight product.")

    if req.consistency:
        parts.append(f"consistency anchor: {req.consistency.strip()}")

    if req.model:
        notes.append(f"Model hint: target {req.model}, keep resolution/duration within supported range.")

    parts.extend(
        [
            "high quality, sharp focus, clean silhouette",
            "soft key light + rim light when appropriate",
        ]
    )

    prompt = ", ".join([p for p in parts if p])

    negative_list = [
        "low quality, blurry, noisy, watermark, text, logo, distortion, broken anatomy",
    ]
    if workflow == "character_creation":
        negative_list.append("exaggerated cartoon proportions, villainous grin, busy background")
    elif workflow == "direct_image":
        negative_list.append("cluttered scene, overexposed or crushed blacks, harsh contrast")
    elif workflow == "merchandise":
        negative_list.append("messy display, background text, strong shadows hiding product")

    negative_prompt = ", ".join(negative_list)

    return PromptResult(
        workflow=workflow,
        prompt=prompt,
        negative_prompt=negative_prompt,
        suggested_aspects=aspects,
        notes=notes,
    )


def generate_prompt(request: PromptRequest) -> PromptResult:
    """Generate a ready-to-use prompt (and negative prompt) for the chosen workflow."""
    if request.language == "en":
        return _en_prompt(request)
    return _cn_prompt(request)
