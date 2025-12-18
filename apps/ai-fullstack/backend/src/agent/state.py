from __future__ import annotations

from typing import TypedDict

from langgraph.graph import add_messages
from typing_extensions import Annotated, NotRequired


import operator


class OverallState(TypedDict):
    messages: Annotated[list, add_messages]
    # Durable conversation memory (a compact summary of earlier turns).
    # The frontend may persist this per-project and provide it back on the next run
    # when LangGraph threads are restarted/expired.
    conversation_summary: NotRequired[str]
    search_query: Annotated[list, operator.add]
    web_research_result: Annotated[list, operator.add]
    sources_gathered: Annotated[list, operator.add]
    initial_search_query_count: int
    max_research_loops: int
    active_role: str
    active_role_name: str
    active_role_reason: str
    active_intent: str
    active_tool_tier: str
    allow_canvas_tools: bool
    allow_canvas_tools_reason: str
    agent_loop_count: int
    research_loop_count: int
    reasoning_model: str
    canvas_context: dict
