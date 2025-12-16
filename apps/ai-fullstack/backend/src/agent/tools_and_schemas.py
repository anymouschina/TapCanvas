from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class SearchQueryList(BaseModel):
    query: List[str] = Field(
        description="A list of search queries to be used for web research."
    )
    rationale: str = Field(
        description="A brief explanation of why these queries are relevant to the research topic."
    )


class Reflection(BaseModel):
    is_sufficient: bool = Field(
        description="Whether the provided summaries are sufficient to answer the user's question."
    )
    knowledge_gap: str = Field(
        description="A description of what information is missing or needs clarification."
    )
    follow_up_queries: List[str] = Field(
        description="A list of follow-up queries to address the knowledge gap."
    )


class RoleDecision(BaseModel):
    role_id: str = Field(
        description="The id of the role that should answer the user. Must be one of the provided role ids."
    )
    role_name: str = Field(
        description="The human-readable name of the selected role."
    )
    reason: str = Field(
        description="Short rationale for why this role matches the user's intent."
    )


class PromptRequest(BaseModel):
    workflow: Literal["character_creation", "direct_image", "merchandise"] = Field(
        description="Which creation flow this prompt is for: character creation, direct image, or merchandise."
    )
    subject: str = Field(
        description="Core subject to render, e.g., '拟人狐狸城市探员' 或 '赛博朋克街景'."
    )
    visual_style: Optional[str] = Field(
        default=None,
        description="Optional style or quality cues, e.g., '高端 3D 动画电影质感, PBR'.",
    )
    model: Optional[str] = Field(
        default=None,
        description="Optional model hint (e.g., Sora/Veo/Banana) to tailor camera or fidelity language.",
    )
    consistency: Optional[str] = Field(
        default=None,
        description="Optional consistency anchor, e.g., '保持同一角色服装与配色'.",
    )
    language: Literal["zh", "en"] = Field(
        default="zh", description="Output language for the prompt text."
    )


class PromptResult(BaseModel):
    workflow: str = Field(description="Echo of the requested workflow.")
    prompt: str = Field(description="Ready-to-use positive prompt.")
    negative_prompt: str = Field(
        description="Optional negative prompt to avoid common failures."
    )
    suggested_aspects: List[str] = Field(
        default_factory=list,
        description="Key aspects the prompt enforces for consistency.",
    )
    notes: List[str] = Field(
        default_factory=list,
        description="Extra guidance for the frontend to apply (e.g., camera/background).",
    )
