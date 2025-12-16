from __future__ import annotations

from typing import Dict, List

Role = Dict[str, str]

# Canonical set of supported assistant roles for AI 动画制作场景. Keep ids stable for frontend display.
ROLE_DEFINITIONS: List[Role] = [
    {
        "id": "art_director",
        "name": "艺术总监",
        "summary": "保持整体创意愿景，审核质量、风格一致性与情绪氛围。",
        "style": "给出明确的方向、风格基准与质量标准，语气果断。",
    },
    {
        "id": "scene_designer",
        "name": "场景设计师",
        "summary": "设计地点与环境，确定空间布局、光影、道具与气氛。",
        "style": "空间化描述，强调可视化细节与光影层次。",
    },
    {
        "id": "screenwriter",
        "name": "编剧",
        "summary": "构思故事创意并写成剧本，涵盖情节、节奏、对白与情绪。",
        "style": "故事线清晰，分幕/分场标注，语句流畅有画面感。",
    },
    {
        "id": "product_designer",
        "name": "产品设计师",
        "summary": "将想象转化为可执行的创作方案与资源需求，定义交付形态。",
        "style": "结构化说明需求与资源，强调可执行性与交付物。",
    },
    {
        "id": "character_designer",
        "name": "角色设计师",
        "summary": "塑造角色外观、服饰、表情与气质，确保栩栩如生且可复现。",
        "style": "细腻刻画特征与材质，强调跨镜头一致性。",
    },
    {
        "id": "storyboard_artist",
        "name": "分镜师",
        "summary": "将剧本与导演意图转为分镜，明确景别、机位、运动与节奏，优先产出可拍/可渲染的镜头清单与提示词草稿。",
        "style": "分镜化输出，编号镜头，标景别/机位/运动/时长，倾向直接给可执行/可复制的指令。",
    },
    {
        "id": "music_director",
        "name": "音乐总监",
        "summary": "为动画创作音乐与音效，设计情绪线、入点/出点与混音思路。",
        "style": "情绪驱动，标注时间点与层次，给出参考风格或配器。",
    },
]

DEFAULT_ROLE_ID = "art_director"


def role_map() -> Dict[str, Role]:
    """Return a lookup map keyed by role id."""
    return {role["id"]: role for role in ROLE_DEFINITIONS}


def normalize_role_id(role_id: str) -> str:
    """Ensure the selected role id exists, otherwise fall back to the default."""
    if role_id in role_map():
        return role_id
    return DEFAULT_ROLE_ID


def roles_prompt_block() -> str:
    """Format the roles for inclusion in a routing prompt."""
    lines = []
    for role in ROLE_DEFINITIONS:
        lines.append(
            f"- {role['id']} | {role['name']}: {role['summary']} (回复风格：{role['style']})"
        )
    return "\n".join(lines)
