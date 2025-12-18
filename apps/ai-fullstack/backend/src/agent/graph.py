from __future__ import annotations

import os
import json
import time
import urllib.request
import urllib.error
import urllib.parse

from agent.tools_and_schemas import (
    RoleDecision,
    SafetyDecision,
    CharacterExtraction,
)
from dotenv import load_dotenv
from openai import OpenAI, APIConnectionError, OpenAIError
from langchain_core.messages import AIMessage
from langgraph.graph import StateGraph
from langgraph.graph import START, END
from langchain_core.runnables import RunnableConfig

from agent.state import (
    OverallState,
)
from agent.configuration import Configuration
from agent.prompts import (
    role_router_instructions,
    get_current_date,
    answer_instructions,
)
from langchain_google_genai import ChatGoogleGenerativeAI
from agent.utils import (
    format_messages_for_prompt,
    get_research_topic,
)
from agent.roles import DEFAULT_ROLE_ID, normalize_role_id, role_map, roles_prompt_block

load_dotenv()

ROLE_ALLOWED_CANVAS_TOOLS: dict[str, set[str]] = {
    # Creative operators
    "storyboard_artist": {"createNode", "updateNode", "connectNodes", "runNode"},
    "character_designer": {"createNode", "updateNode", "connectNodes", "runNode"},
    "scene_designer": {"createNode", "updateNode", "connectNodes", "runNode"},
    # Governance / writing-only roles
    "art_director": set(),
    "screenwriter": set(),
    "product_designer": set(),
    "music_director": set(),
    # Safety rewrite role: should not mutate canvas unless explicitly requested/confirmed
    "magician": set(),
}

def _render_canvas_context_for_prompt(canvas_context: dict | None) -> str:
    """Render a compact, safe canvas context summary for prompts.

    NOTE: Do not include negativePrompt previews to avoid contaminating safety classifiers
    and to reduce accidental keyword-trigger loops.
    """
    if not isinstance(canvas_context, dict):
        return ""
    summary = canvas_context.get("summary") if isinstance(canvas_context.get("summary"), dict) else {}
    node_count = summary.get("nodeCount")
    edge_count = summary.get("edgeCount")
    kinds = summary.get("kinds") if isinstance(summary.get("kinds"), list) else []

    parts: list[str] = []
    meta_bits: list[str] = []
    if isinstance(node_count, int):
        meta_bits.append(f"nodes={node_count}")
    if isinstance(edge_count, int):
        meta_bits.append(f"edges={edge_count}")
    if kinds:
        kinds_str = ", ".join([str(k) for k in kinds[:8] if isinstance(k, (str, int, float))])
        if kinds_str:
            meta_bits.append(f"kinds=[{kinds_str}]")
    if meta_bits:
        parts.append("summary: " + " | ".join(meta_bits))

    characters = canvas_context.get("characters")
    if isinstance(characters, list) and characters:
        parts.append("characters:")
        for c in characters[:6]:
            if not isinstance(c, dict):
                continue
            label = c.get("label") or c.get("username") or c.get("nodeId")
            desc = c.get("description")
            line = f"- {str(label)[:80]}" if label else "- (unnamed)"
            if isinstance(desc, str) and desc.strip():
                line += f" | {desc.strip()[:140]}"
            parts.append(line)

    story_ctx = canvas_context.get("storyContext")
    if isinstance(story_ctx, list) and story_ctx:
        parts.append("storyContext (recent excerpts):")
        for item in story_ctx[:2]:
            if not isinstance(item, dict):
                continue
            label = item.get("label") or item.get("nodeId") or ""
            excerpt = item.get("promptExcerpt") or ""
            if isinstance(excerpt, str) and excerpt.strip():
                parts.append(f"- {str(label)[:60]}: {excerpt.strip()[:500]}")

    timeline = canvas_context.get("timeline")
    if isinstance(timeline, list) and timeline:
        parts.append("timeline (top):")
        for t in timeline[:6]:
            if not isinstance(t, dict):
                continue
            label = t.get("label") or t.get("nodeId")
            kind = t.get("kind")
            status = t.get("status")
            dur = t.get("duration")
            bits: list[str] = []
            if label:
                bits.append(str(label)[:80])
            if kind:
                bits.append(f"kind={str(kind)[:24]}")
            if status:
                bits.append(f"status={str(status)[:16]}")
            if isinstance(dur, (int, float)):
                bits.append(f"duration={int(dur)}s")
            if bits:
                parts.append("- " + " | ".join(bits))

    nodes = canvas_context.get("nodes")
    if isinstance(nodes, list) and nodes:
        parts.append("nodes (sample):")
        for n in nodes[:10]:
            if not isinstance(n, dict):
                continue
            label = n.get("label") or n.get("id")
            kind = n.get("kind") or n.get("type")
            status = n.get("status")
            prompt_preview = n.get("promptPreview")
            bits: list[str] = []
            if label:
                bits.append(str(label)[:80])
            if kind:
                bits.append(f"kind={str(kind)[:24]}")
            if status:
                bits.append(f"status={str(status)[:16]}")
            if isinstance(prompt_preview, str) and prompt_preview.strip():
                bits.append(f"prompt='{prompt_preview.strip()[:120]}'")
            if bits:
                parts.append("- " + " | ".join(bits))

    return "\n".join(parts).strip()

def _autorag_normalize_result(result: dict) -> tuple[list[str], list[dict]]:
    """Best-effort normalize AutoRAG result into (snippets, sources)."""
    snippets: list[str] = []
    sources: list[dict] = []

    if not isinstance(result, dict):
        return snippets, sources

    answer = result.get("answer") or result.get("output") or result.get("response")
    if isinstance(answer, str) and answer.strip():
        snippets.append(answer.strip())

    raw_sources = result.get("sources") or result.get("results") or result.get("documents") or []
    if isinstance(raw_sources, list):
        for idx, item in enumerate(raw_sources[:8], start=1):
            if not isinstance(item, dict):
                continue
            title = item.get("title") or item.get("label") or item.get("name") or f"KB#{idx}"
            url = item.get("url") or item.get("source_url") or item.get("source") or ""
            text = item.get("text") or item.get("content") or item.get("snippet") or ""
            score = item.get("score") or item.get("similarity") or None
            line_bits: list[str] = []
            if isinstance(title, str) and title.strip():
                line_bits.append(title.strip())
            if isinstance(url, str) and url.strip():
                line_bits.append(url.strip())
            if score is not None:
                try:
                    line_bits.append(f"score={float(score):.3f}")
                except Exception:
                    pass
            header = " | ".join(line_bits).strip()
            body = text.strip() if isinstance(text, str) else ""
            if body:
                snippets.append(f"[{idx}] {header}\n{body}" if header else f"[{idx}]\n{body}")
            if isinstance(url, str) and url.strip():
                sources.append({"label": title if isinstance(title, str) else f"KB#{idx}", "value": url, "short_url": url})

    if not snippets:
        try:
            snippets.append(json.dumps(result, ensure_ascii=False)[:4000])
        except Exception:
            snippets.append(str(result)[:4000])
    return snippets, sources


def _call_autorag_search(configurable: Configuration, query: str) -> tuple[list[str], list[dict]]:
    """Call Worker-side AutoRAG proxy and return (web_research_result, sources_gathered)."""
    endpoint = (configurable.autorag_endpoint or "").strip()
    rag_id = (configurable.autorag_id or "").strip()
    secret = (os.getenv("INTERNAL_API_SECRET") or "").strip()
    if not endpoint or not rag_id or not query.strip():
        return [], []

    payload = json.dumps({"ragId": rag_id, "query": query}).encode("utf-8")
    headers = {"content-type": "application/json"}
    if secret:
        headers["x-internal-secret"] = secret
    req = urllib.request.Request(
        endpoint,
        method="POST",
        data=payload,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body = str(exc)
        return [f"[AutoRAG] HTTP {exc.code}: {body[:2000]}"], []
    except Exception as exc:
        return [f"[AutoRAG] 请求失败: {exc}"], []

    try:
        decoded = json.loads(body)
    except Exception:
        return [f"[AutoRAG] 非 JSON 响应: {body[:2000]}"], []

    result = decoded.get("result") if isinstance(decoded, dict) else decoded
    snippets, sources = _autorag_normalize_result(result if isinstance(result, dict) else {"result": result})
    if os.getenv("DEBUG_OPENAI_RESPONSES") == "1":
        try:
            print(
                "[AUTORAG] ok",
                f"rag_id={rag_id}",
                f"query={query[:160]}",
                f"snippets={len(snippets)}",
                f"sources={len(sources)}",
            )
            if snippets:
                print("[AUTORAG] snippet0:", (snippets[0] or "")[:500])
        except Exception:
            pass
    return snippets, sources


def require_gemini_key() -> None:
    """Ensure a Gemini key is available before using Gemini models."""
    if (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")) is None:
        raise ValueError(
            "Gemini API key is not set; provide GEMINI_API_KEY or GOOGLE_API_KEY."
        )


def get_gemini_api_key() -> str:
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if key is None:
        require_gemini_key()
        raise ValueError("Gemini API key is missing.")
    return key


def resolve_llm_provider(raw: str | None) -> str:
    """Resolve provider from config + env.

    Supports: 'auto', 'openai', 'gemini'. Defaults to OpenAI when OPENAI_API_KEY is set.
    """
    value = str(raw or "").strip().lower()
    if value in ("openai", "gemini"):
        return value
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    if os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"):
        return "gemini"
    return "openai"


def get_openai_client() -> OpenAI:
    """Return an OpenAI client configured with optional custom base URL."""
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key is None:
        raise ValueError("OPENAI_API_KEY is not set; required for OpenAI-based steps.")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    # Common pitfall: setting OPENAI_BASE_URL to localhost on the host machine.
    # Inside Docker, localhost points to the container itself, so rewrite to host.docker.internal.
    try:
        if os.path.exists("/.dockerenv"):
            parsed = urllib.parse.urlparse(base_url)
            if parsed.hostname in ("127.0.0.1", "localhost"):
                rewritten = parsed._replace(netloc=f"host.docker.internal:{parsed.port}" if parsed.port else "host.docker.internal")
                base_url = urllib.parse.urlunparse(rewritten)
    except Exception:
        pass
    return OpenAI(api_key=api_key, base_url=base_url)


def debug_openai_response(prefix: str, response) -> None:
    """Print limited OpenAI response info when DEBUG_OPENAI_RESPONSES=1."""
    if os.getenv("DEBUG_OPENAI_RESPONSES") != "1":
        return
    try:
        print(f"[DEBUG_OPENAI] {prefix} raw={response!r}")
    except Exception as exc:  # pragma: no cover
        print(f"[DEBUG_OPENAI] {prefix} debug error: {exc}")


def _format_openai_error(exc: Exception) -> dict:
    """Best-effort extraction of actionable OpenAI error details (safe for logs)."""
    payload: dict = {"type": exc.__class__.__name__}
    payload["message"] = str(exc)
    for attr in ("status_code", "code", "param", "type", "request_id"):
        val = getattr(exc, attr, None)
        if val is not None:
            payload[attr] = val
    body = getattr(exc, "body", None)
    if body is not None:
        payload["body"] = body
    resp = getattr(exc, "response", None)
    if resp is not None:
        try:
            payload["response_status"] = getattr(resp, "status_code", None)
        except Exception:
            pass
        try:
            text = getattr(resp, "text", None)
            if isinstance(text, str) and text:
                payload["response_text"] = text[:4000]
        except Exception:
            pass
    return payload


def _summarize_openai_error(payload: dict) -> str:
    """Create a short human-readable error string from _format_openai_error()."""
    status = payload.get("status_code") or payload.get("response_status")
    body = payload.get("body")
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            msg = err.get("message")
            code = err.get("code")
            param = err.get("param")
            bits = []
            if isinstance(msg, str) and msg:
                bits.append(msg)
            if isinstance(code, str) and code:
                bits.append(f"code={code}")
            if isinstance(param, str) and param:
                bits.append(f"param={param}")
            if bits:
                core = "; ".join(bits)
                return f"{status}: {core}" if status else core
    msg = payload.get("message")
    if isinstance(msg, str) and msg:
        return f"{status}: {msg}" if status else msg
    return f"{status}" if status else "unknown"


def debug_openai_error(prefix: str, exc: Exception) -> None:
    """Print OpenAI error details when DEBUG_OPENAI_RESPONSES=1."""
    if os.getenv("DEBUG_OPENAI_RESPONSES") != "1":
        return
    try:
        print(f"[DEBUG_OPENAI_ERROR] {prefix} {_format_openai_error(exc)}")
    except Exception as inner_exc:  # pragma: no cover
        print(f"[DEBUG_OPENAI_ERROR] {prefix} debug error: {inner_exc}")


def _fallback_text_from_tool_calls(tool_calls: list[dict]) -> str:
    """Generate a short user-facing confirmation when the model returned only tool calls."""
    creates = [c for c in tool_calls if c.get("name") == "createNode"]
    updates = [c for c in tool_calls if c.get("name") == "updateNode"]
    connects = [c for c in tool_calls if c.get("name") == "connectNodes"]
    runs = [c for c in tool_calls if c.get("name") == "runNode"]

    labels: list[str] = []
    for c in creates:
        args = c.get("arguments") or {}
        label = args.get("label")
        if isinstance(label, str) and label.strip():
            labels.append(label.strip())

    parts: list[str] = []
    if creates:
        if labels:
            head = "、".join(labels[:3])
            tail = "…" if len(labels) > 3 else ""
            parts.append(f"已在画布创建节点：{head}{tail}")
        else:
            parts.append(f"已在画布创建 {len(creates)} 个节点")
    if updates:
        parts.append(f"已更新 {len(updates)} 个节点")
    if connects:
        parts.append(f"已连接 {len(connects)} 条连线")
    if runs:
        parts.append(f"已触发运行 {len(runs)} 个节点")

    if not parts:
        return "已更新画布。"
    return "；".join(parts) + "。"


def _composevideo_prompt_from_structured_config(cfg: dict) -> str:
    """Coerce a structured storyboard config into a single prompt string."""
    duration = cfg.get("durationSeconds") or cfg.get("duration") or cfg.get("duration_sec")
    fps = cfg.get("fps")
    aspect = cfg.get("aspectRatio") or cfg.get("aspect") or cfg.get("ratio")
    style = cfg.get("style") or cfg.get("visualStyle") or cfg.get("look")
    music = cfg.get("musicSfx") or cfg.get("music") or cfg.get("sfx")
    characters = cfg.get("characters") if isinstance(cfg.get("characters"), list) else []
    shots = cfg.get("shots") if isinstance(cfg.get("shots"), list) else []

    parts: list[str] = []
    parts.append("10–15秒分镜视频提示词（分镜清单 + 镜头语言）")
    meta_bits: list[str] = []
    if isinstance(duration, (int, float)):
        meta_bits.append(f"时长: {duration}s")
    if isinstance(fps, (int, float)):
        meta_bits.append(f"FPS: {int(fps)}")
    if isinstance(aspect, str) and aspect.strip():
        meta_bits.append(f"画幅: {aspect.strip()}")
    if meta_bits:
        parts.append(" / ".join(meta_bits))
    if isinstance(style, str) and style.strip():
        parts.append(f"风格基准: {style.strip()}")
    if isinstance(music, str) and music.strip():
        parts.append(f"音乐/音效: {music.strip()}")

    if characters:
        parts.append("")
        parts.append("角色（保持与画布设定一致）：")
        for c in characters:
            if not isinstance(c, dict):
                continue
            ref = c.get("ref") or c.get("label") or c.get("nodeId")
            name = c.get("name")
            notes = c.get("notes")
            line = "- "
            if isinstance(name, str) and name.strip():
                line += name.strip()
            if isinstance(ref, str) and ref.strip():
                line += f"（参考: {ref.strip()}）" if line.strip() != "-" else ref.strip()
            if isinstance(notes, str) and notes.strip():
                line += f"：{notes.strip()}"
            if line.strip() != "-":
                parts.append(line)

    if shots:
        parts.append("")
        parts.append("分镜（逐镜头）：")
        for idx, s in enumerate(shots, start=1):
            if not isinstance(s, dict):
                continue
            sid = s.get("id") or f"S{idx}"
            time_range = s.get("time")
            shot_size = s.get("shotSize")
            camera = s.get("camera")
            movement = s.get("movement")
            action = s.get("action")
            composition = s.get("composition")
            seg: list[str] = []
            header = f"{sid}"
            if isinstance(time_range, str) and time_range.strip():
                header += f"（{time_range.strip()}）"
            seg.append(header)
            if isinstance(shot_size, str) and shot_size.strip():
                seg.append(f"景别: {shot_size.strip()}")
            if isinstance(camera, str) and camera.strip():
                seg.append(f"机位/镜头: {camera.strip()}")
            if isinstance(movement, str) and movement.strip():
                seg.append(f"运动: {movement.strip()}")
            if isinstance(action, str) and action.strip():
                seg.append(f"内容: {action.strip()}")
            if isinstance(composition, str) and composition.strip():
                seg.append(f"构图: {composition.strip()}")
            parts.append("- " + "；".join(seg))

    # If nothing useful, fall back to any existing freeform prompt keys.
    out = "\n".join([p for p in parts if isinstance(p, str)]).strip()
    if out:
        return out
    for key in ("prompt", "videoPrompt", "storyboard"):
        val = cfg.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _collect_stream_text(stream) -> str:
    """Collect text from streaming Responses API iterator."""
    parts: list[str] = []
    try:
        for chunk in stream:
            if os.getenv("DEBUG_OPENAI_RESPONSES") == "1":
                try:
                    print(f"[DEBUG_OPENAI_STREAM] {chunk!r}")
                except Exception:
                    pass
            # Responses API streaming events
            ev_type = getattr(chunk, "type", None)
            if ev_type and isinstance(ev_type, str) and "output_text.delta" in ev_type:
                delta = getattr(chunk, "delta", None)
                if delta:
                    parts.append(str(delta))
                    continue
                data = getattr(chunk, "data", None) or getattr(chunk, "output_text", None)
                if data:
                    parts.append(str(data))
                    continue
            if ev_type and isinstance(ev_type, str) and "response.output_text" in ev_type:
                text = getattr(chunk, "output_text", None)
                if text:
                    parts.append(str(text))
                    continue
            # chat.completions stream (not used now but kept)
            choice = getattr(chunk, "choices", None)
            if choice:
                choice = choice[0]
                delta = getattr(choice, "delta", None) or {}
                content = delta.get("content")
                if isinstance(content, str):
                    parts.append(content)
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("text"):
                            parts.append(block["text"])
                        elif isinstance(block, str):
                            parts.append(block)
                        elif hasattr(block, "text") and getattr(block, "text"):
                            parts.append(getattr(block, "text"))
                continue
            # Dict fallback
            if isinstance(chunk, dict):
                if "delta" in chunk:
                    parts.append(str(chunk["delta"]))
                    continue
                if "output_text" in chunk:
                    parts.append(str(chunk["output_text"]))
                    continue
                data = chunk.get("data")
                if isinstance(data, dict):
                    if "delta" in data:
                        parts.append(str(data["delta"]))
                        continue
                    if "output_text" in data:
                        parts.append(str(data["output_text"]))
                        continue
    except Exception:
        pass
    return "".join(parts)


def _collect_stream_text_and_tools(stream) -> tuple[str, list[dict]]:
    """Collect text and any tool calls from streaming Responses API iterator."""
    parts: list[str] = []
    tool_calls_by_id: dict[str, dict] = {}
    alias_to_call_id: dict[str, str] = {}
    try:
        for chunk in stream:
            # tool calls (Responses API streaming events)
            ev_type = getattr(chunk, "type", None)
            if ev_type == "response.output_item.added" or ev_type == "response.output_item.done":
                item = getattr(chunk, "item", None)
                if getattr(item, "type", None) == "function_call":
                    call_id = getattr(item, "call_id", None)
                    item_id = getattr(item, "id", None)
                    name = getattr(item, "name", None)
                    arguments = getattr(item, "arguments", "") or ""
                    if call_id:
                        alias_to_call_id[call_id] = call_id
                        if item_id:
                            alias_to_call_id[item_id] = call_id
                        record = tool_calls_by_id.get(call_id) or {
                            "id": call_id,
                            "name": name,
                            "arguments": "",
                        }
                        # name can arrive early; arguments may be partial and updated by delta/done events
                        if name:
                            record["name"] = name
                        if isinstance(arguments, str) and arguments:
                            record["arguments"] = arguments
                        tool_calls_by_id[call_id] = record
            elif ev_type == "response.function_call_arguments.delta":
                item_id = getattr(chunk, "item_id", None)
                delta = getattr(chunk, "delta", "") or ""
                if item_id and isinstance(delta, str):
                    call_id = alias_to_call_id.get(item_id, item_id)
                    record = tool_calls_by_id.get(call_id) or {
                        "id": call_id,
                        "name": None,
                        "arguments": "",
                    }
                    record["arguments"] = (record.get("arguments") or "") + delta
                    tool_calls_by_id[call_id] = record
            elif ev_type == "response.function_call_arguments.done":
                item_id = getattr(chunk, "item_id", None)
                arguments = getattr(chunk, "arguments", "") or ""
                if item_id and isinstance(arguments, str):
                    call_id = alias_to_call_id.get(item_id, item_id)
                    record = tool_calls_by_id.get(call_id) or {
                        "id": call_id,
                        "name": None,
                        "arguments": "",
                    }
                    record["arguments"] = arguments
                    tool_calls_by_id[call_id] = record

            # text
            if ev_type and isinstance(ev_type, str) and "output_text.delta" in ev_type:
                delta = getattr(chunk, "delta", None)
                if delta:
                    parts.append(str(delta))
                    continue
                data = getattr(chunk, "data", None) or getattr(chunk, "output_text", None)
                if data:
                    parts.append(str(data))
                    continue
            if ev_type and isinstance(ev_type, str) and "response.output_text" in ev_type:
                text = getattr(chunk, "output_text", None)
                if text:
                    parts.append(str(text))
                    continue
            choice = getattr(chunk, "choices", None)
            if choice:
                choice = choice[0]
                delta = getattr(choice, "delta", None) or {}
                content = delta.get("content")
                if isinstance(content, str):
                    parts.append(content)
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("text"):
                            parts.append(block["text"])
                        elif isinstance(block, str):
                            parts.append(block)
                        elif hasattr(block, "text") and getattr(block, "text"):
                            parts.append(getattr(block, "text"))
                continue
            if isinstance(chunk, dict):
                if "delta" in chunk:
                    parts.append(str(chunk["delta"]))
                    continue
                if "output_text" in chunk:
                    parts.append(str(chunk["output_text"]))
                    continue
                data = chunk.get("data")
                if isinstance(data, dict):
                    if "delta" in data:
                        parts.append(str(data["delta"]))
                        continue
                    if "output_text" in data:
                        parts.append(str(data["output_text"]))
                        continue
    except Exception:
        pass
    tool_calls: list[dict] = []
    for call in tool_calls_by_id.values():
        name = call.get("name")
        if not name:
            continue
        args = call.get("arguments")
        parsed_args = args
        if isinstance(args, str):
            try:
                parsed_args = json.loads(args) if args.strip() else {}
            except Exception:
                parsed_args = args
        tool_calls.append({"id": call.get("id"), "name": name, "arguments": parsed_args})
    return "".join(parts), tool_calls


def _to_chat_completions_tools(response_api_tools: list[dict] | None) -> list[dict]:
    """Convert Responses-API style tools to Chat Completions tool schema."""
    if not isinstance(response_api_tools, list) or not response_api_tools:
        return []
    out: list[dict] = []
    for t in response_api_tools:
        if not isinstance(t, dict):
            continue
        if t.get("type") != "function":
            continue
        name = t.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        out.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": t.get("description") or "",
                    "parameters": t.get("parameters") or {"type": "object", "properties": {}},
                },
            }
        )
    return out


def _parse_chat_completions_tool_calls(message) -> list[dict]:
    """Parse tool calls from Chat Completions message object."""
    calls = getattr(message, "tool_calls", None) or []
    out: list[dict] = []
    for c in calls:
        try:
            cid = getattr(c, "id", None)
            fn = getattr(c, "function", None)
            name = getattr(fn, "name", None) if fn is not None else None
            args = getattr(fn, "arguments", None) if fn is not None else None
            parsed_args = args
            if isinstance(args, str):
                try:
                    parsed_args = json.loads(args) if args.strip() else {}
                except Exception:
                    parsed_args = args
            out.append({"id": cid, "name": name, "arguments": parsed_args})
        except Exception:
            continue
    return out


def _normalize_tool_calls_payload(tool_calls: list[dict]) -> list[dict]:
    """Normalize tool call payloads so downstream code can safely access dict arguments.

    - If arguments is a JSON string, parse it.
    - If arguments is invalid JSON, drop the tool call (better than crashing the run).
    - If arguments is missing/other type, coerce to {}.
    """
    if not isinstance(tool_calls, list) or not tool_calls:
        return []
    normalized: list[dict] = []
    for c in tool_calls:
        if not isinstance(c, dict):
            continue
        name = c.get("name")
        if not name:
            continue
        args = c.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args) if args.strip() else {}
            except Exception:
                # Malformed JSON (often due to truncated stream); skip to avoid runtime errors.
                continue
        if not isinstance(args, dict):
            args = {}
        normalized.append({"id": c.get("id"), "name": name, "arguments": args})
    return normalized


def _looks_like_story_request(text: str) -> bool:
    """Heuristic: user pasted story text that should trigger the animation pipeline.

    We default to triggering in Agent/Agent Max when the user provides a long-form narrative,
    even if they didn't explicitly say "generate storyboard/video".
    """
    if not isinstance(text, str):
        return False
    t = text.strip()
    if not t:
        return False
    # Avoid triggering on code/payload dumps.
    if "```" in t or t.count("{") > 20 or t.count(";") > 40:
        return False

    # Long multi-paragraph text is a strong signal.
    long_form = len(t) >= 500 and (t.count("\n") >= 2 or t.count("。") >= 6 or t.count(".") >= 8)
    if not long_form:
        return False

    # Intent hints (strong positive).
    intent = any(
        k in t
        for k in (
            "分镜",
            "九宫格",
            "故事板",
            "动画",
            "短片",
            "成片",
            "视频",
            "日漫",
            "2d",
            "2D",
        )
    )

    # Narrative cues (weaker positive): dialogues, pronouns, scene/action verbs.
    narrative = any(k in t for k in ("“", "”", "他", "她", "他们", "忽然", "转身", "抬头", "回头", "是夜"))
    return intent or narrative


def _get_last_user_text(state: dict) -> str:
    try:
        for m in reversed(state.get("messages") or []):
            if getattr(m, "type", None) == "human" or getattr(m, "role", None) == "user":
                return str(getattr(m, "content", "") or "")
    except Exception:
        pass
    return ""


def _canvas_label_index(canvas_context_obj: dict | None) -> dict[str, dict]:
    """Return {label: node_dict} index for nodes in canvas_context."""
    if not isinstance(canvas_context_obj, dict):
        return {}
    nodes = canvas_context_obj.get("nodes")
    if not isinstance(nodes, list):
        return {}
    out: dict[str, dict] = {}
    for n in nodes:
        if not isinstance(n, dict):
            continue
        label = n.get("label")
        if not isinstance(label, str) or not label.strip():
            continue
        out[label.strip()] = n
    return out


def _canvas_existing_pairs_by_label(canvas_context_obj: dict | None) -> set[tuple[str, str]]:
    """Return {(sourceLabel, targetLabel)} for edges present in canvas_context.

    Note: canvas_context edges use node ids. We map ids to labels using nodes[].
    """
    if not isinstance(canvas_context_obj, dict):
        return set()
    nodes = canvas_context_obj.get("nodes")
    edges = canvas_context_obj.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return set()
    id_to_label: dict[str, str] = {}
    for n in nodes:
        if not isinstance(n, dict):
            continue
        nid = n.get("id")
        label = n.get("label")
        if isinstance(nid, str) and nid.strip() and isinstance(label, str) and label.strip():
            id_to_label[nid.strip()] = label.strip()
    pairs: set[tuple[str, str]] = set()
    for e in edges:
        if not isinstance(e, dict):
            continue
        src = e.get("source")
        tgt = e.get("target")
        if not isinstance(src, str) or not isinstance(tgt, str):
            continue
        sl = id_to_label.get(src.strip())
        tl = id_to_label.get(tgt.strip())
        if sl and tl:
            pairs.add((sl, tl))
    return pairs


def _node_is_success_media(node: dict | None) -> bool:
    if not isinstance(node, dict):
        return False
    if node.get("status") != "success":
        return False
    has_image = isinstance(node.get("imageUrl"), str) and node.get("imageUrl").strip()
    has_video = isinstance(node.get("videoUrl"), str) and node.get("videoUrl").strip()
    return bool(has_image or has_video)


def _deterministic_tool_id(prefix: str, *parts: str) -> str:
    safe: list[str] = []
    for p in parts:
        if not isinstance(p, str):
            continue
        s = p.strip().replace("\n", " ")
        if len(s) > 120:
            s = s[:120]
        safe.append(s)
    joined = "|".join([prefix, *safe])
    return joined[:220]


def _synthesize_story_pipeline_tool_calls(
    state: OverallState,
    configurable: Configuration,
    *,
    interaction_mode: str,
    story_text: str,
) -> tuple[list[dict], str]:
    """Deterministically build tool calls for: character refs -> storyboard -> video.

    Uses canvas_context to skip already-success nodes and avoid duplicate edges.
    """
    canvas_context_obj = state.get("canvas_context")
    node_by_label = _canvas_label_index(canvas_context_obj)
    existing_pairs = _canvas_existing_pairs_by_label(canvas_context_obj)

    style = "日漫2D（干净线稿+赛璐璐），现实荒诞→清冷民俗志怪，冷蓝灰夜戏，PG-13克制表达"
    mains, _props = _extract_characters_from_story(configurable, story_text or "")

    duration_seconds = 12
    if "15" in (story_text or "") or "15秒" in (story_text or ""):
        duration_seconds = 15

    wants_video = any(k in (story_text or "") for k in ("视频", "动画", "短片", "成片", "生成"))
    auto_run_video = interaction_mode == "agent_max" or wants_video

    tool_calls: list[dict] = []
    ref_labels: list[str] = []

    def ensure_image_node(label: str, *, prompt: str, negative: str, image_model: str = "nano-banana-fast"):
        existing = node_by_label.get(label)
        if existing and _node_is_success_media(existing):
            return
        if not existing:
            tool_calls.append(
                {
                    "id": _deterministic_tool_id("auto:createNode:image", label),
                    "name": "createNode",
                    "arguments": {
                        "type": "image",
                        "label": label,
                        "config": {
                            "kind": "image",
                            "imageModel": image_model,
                            "prompt": prompt,
                            "negativePrompt": negative,
                        },
                    },
                }
            )
        tool_calls.append(
            {
                "id": _deterministic_tool_id("auto:runNode", label),
                "name": "runNode",
                "arguments": {"nodeId": label},
            }
        )

    def ensure_compose_video_create(label: str, *, prompt: str, duration: int):
        """Create composeVideo node if missing; do not run it (run is added after wiring references)."""
        existing = node_by_label.get(label)
        if existing and _node_is_success_media(existing):
            return
        if existing:
            return
        tool_calls.append(
            {
                "id": _deterministic_tool_id("auto:createNode:composeVideo", label),
                "name": "createNode",
                "arguments": {
                    "type": "composeVideo",
                    "label": label,
                    "config": {
                        "kind": "composeVideo",
                        "videoModel": "sora-2",
                        "videoDurationSeconds": duration,
                        "prompt": prompt,
                    },
                },
            }
        )

    def ensure_edge(src_label: str, tgt_label: str):
        if not src_label or not tgt_label:
            return
        if (src_label, tgt_label) in existing_pairs:
            return
        tool_calls.append(
            {
                "id": _deterministic_tool_id("auto:connectNodes", src_label, "->", tgt_label),
                "name": "connectNodes",
                "arguments": {
                    "sourceNodeId": src_label,
                    "targetNodeId": tgt_label,
                    "sourceHandle": "out-image",
                    "targetHandle": "in-image",
                },
            }
        )

    # 1) Character refs (limit to 3 for cost)
    for name in (mains or [])[:3]:
        label = f"角色三视图-{name}"
        p, n = _build_character_turnaround_prompt(name, style=style)
        ensure_image_node(label, prompt=p, negative=n)
        ref_labels.append(label)

    # 2) Prop sheet when explicitly present in story
    if any(k in (story_text or "") for k in ("线装书", "恶鬼", "画像")):
        prop_label = "道具设定-线装书与恶鬼画像"
        ensure_image_node(
            prop_label,
            prompt=(
                "日漫2D道具设定图：一张画面内包含两部分。\n"
                "A区：陈旧线装书三视图（封面正面、侧面书脊、摊开内页），暖黄色硬皮封面，粗麻线穿孔装订，书页泛黄、边缘微卷。\n"
                "B区：书页上的“恶鬼插画”设定特写 + 小范围结构分解（只做图案语言，不要实体化）：墨色褪色、线条阴冷、民俗志怪感；不出现血腥。\n"
                "背景干净浅灰；信息清晰，适合后续分镜复用。"
            ),
            negative="写实摄影、3D渲染、复杂场景背景、血腥/内脏/断肢、跳出纸面实体怪物、低俗恐怖、文字水印",
        )
        ref_labels.append(prop_label)

    # 3) Storyboard (3x3 image)
    storyboard_label = f"九宫格分镜-故事提炼{duration_seconds}秒（日漫2D）"
    sp, sn = _build_storyboard_prompt(story_text or "", style=style, duration_seconds=duration_seconds)
    existing_storyboard = node_by_label.get(storyboard_label)
    if not (existing_storyboard and _node_is_success_media(existing_storyboard)):
        if not existing_storyboard:
            tool_calls.append(
                {
                    "id": _deterministic_tool_id("auto:createNode:image", storyboard_label),
                    "name": "createNode",
                    "arguments": {
                        "type": "image",
                        "label": storyboard_label,
                        "config": {
                            "kind": "image",
                            "imageModel": "nano-banana-fast",
                            "prompt": sp,
                            "negativePrompt": sn,
                        },
                    },
                }
            )
        for ref in ref_labels[:6]:
            ensure_edge(ref, storyboard_label)
        tool_calls.append(
            {
                "id": _deterministic_tool_id("auto:runNode", storyboard_label),
                "name": "runNode",
                "arguments": {"nodeId": storyboard_label},
            }
        )

    # 4) Video (composeVideo) + connect storyboard -> video
    video_label = f"短片-故事提炼{duration_seconds}秒（日漫2D）"
    video_prompt = (
        f"基于输入的九宫格分镜图生成一段{duration_seconds}秒日漫2D短片。"
        "风格：2D赛璐璐、干净线条、冷蓝灰色调；"
        "恐怖表达克制PG-13：用影子、线条活化、空间轻微扭曲、音画错位；不要血腥与直白怪物扑脸。"
    )
    existing_video = node_by_label.get(video_label)
    if not (existing_video and _node_is_success_media(existing_video)):
        ensure_compose_video_create(video_label, duration=duration_seconds, prompt=video_prompt)
        ensure_edge(storyboard_label, video_label)
        if auto_run_video:
            tool_calls.append(
                {
                    "id": _deterministic_tool_id("auto:runNode", video_label),
                    "name": "runNode",
                    "arguments": {"nodeId": video_label},
                }
            )

    text = (
        "已从故事中自动提取主要角色并生成角色三视参考，随后生成九宫格分镜并生成短片。"
        "如果你想把更长剧情拆成多段 10–15 秒连续短片，我可以继续自动拆分生成 Part 2/3。"
    )
    return tool_calls, text


def _extract_characters_from_story(
    configurable: Configuration, story_text: str
) -> tuple[list[str], list[str]]:
    """Return (main_characters, key_props). Best-effort, safe defaults."""
    # Fast heuristic fallback (works offline / when structured call fails).
    def heuristic(text: str) -> tuple[list[str], list[str]]:
        candidates: list[str] = []
        for name in ("李长安", "李老头"):
            if name in text:
                candidates.append(name)
        if "开发商" in text:
            candidates.append("开发商")
        if "黑西装" in text or "黑老大" in text:
            candidates.append("黑西装老大")
        # de-dup preserve order
        seen = set()
        main: list[str] = []
        for n in candidates:
            if n in seen:
                continue
            seen.add(n)
            main.append(n)
        props: list[str] = []
        if "线装书" in text or ("线装" in text and "书" in text):
            props.append("线装书")
        if "棺材" in text:
            props.append("棺材")
        if "挖掘机" in text:
            props.append("挖掘机")
        if "纸钱" in text:
            props.append("纸钱")
        return (main[:4] or ["主角"], props[:4])

    try:
        # Keep the extraction prompt short to avoid token blowups.
        excerpt = story_text.strip()
        if len(excerpt) > 6000:
            excerpt = excerpt[:6000]
        prompt = (
            "Extract characters for an animation pipeline.\n"
            "Return JSON that matches the provided schema.\n"
            "Rules:\n"
            "- Only include characters that appear in the text.\n"
            "- Mark main recurring characters (is_main=true) that should get a 3-view turnaround.\n"
            "- Keep names in Chinese as-is.\n"
            "- Also extract key props for consistency.\n\n"
            f"STORY_TEXT:\n{excerpt}\n"
        )
        model = getattr(configurable, "role_selector_model", None) or configurable.answer_model
        result = _call_openai_structured(model, prompt, CharacterExtraction)
        mains = [n for n in (result.main_characters or []) if isinstance(n, str) and n.strip()]
        if not mains:
            mains = [c.name for c in (result.characters or []) if getattr(c, "is_main", False) and c.name]
        mains = [n.strip() for n in mains if n.strip()]
        props = [p.strip() for p in (result.key_props or []) if isinstance(p, str) and p.strip()]
        # Clamp
        return (mains[:4] or heuristic(story_text)[0], props[:4] or heuristic(story_text)[1])
    except Exception:
        return heuristic(story_text)


def _build_character_turnaround_prompt(name: str, *, style: str) -> tuple[str, str]:
    prompt = (
        "日漫2D角色设定图，三视图同画面（正面/侧面/背面），全身站姿，A-pose（手臂自然下垂略外展）以便看清服装结构；"
        "三视同一身高、肩宽、头身比一致；脸型五官一致，发型轮廓一致；线条干净利落，赛璐璐平涂，少量材质高光与阴影；"
        "纯浅灰背景；脚底对齐同一地面线；清晰服装结构与褶皱逻辑（口袋/拉链/领口/袖口可读）；适合后续分镜复用。\n"
        f"角色：{name}。\n"
        f"风格：{style}。\n"
        "要求：不要换脸、不要换衣服、不要改变发型分缝；三视一致。"
    )
    negative = (
        "写实3D，真人照片感，过度肌肉，Q版幼态大头，夸张大眼萌系，复杂背景/场景，三视图不一致（换衣/换发/换脸/比例漂移），"
        "多余人物，血腥、断肢、内脏，恐怖特写，强烈霓虹色光，过曝，手指畸形，多本书，多张脸，文字水印"
    )
    return prompt, negative


def _build_storyboard_prompt(story_text: str, *, style: str, duration_seconds: int) -> tuple[str, str]:
    excerpt = story_text.strip()
    if len(excerpt) > 4800:
        excerpt = excerpt[:4800]
    prompt = (
        "把下面故事改编成一张 3x3 九宫格分镜图（同一张图里 9 个镜头），日漫2D动画分镜稿风格；"
        "每格标注镜头号与时长（总时长控制在 10–15 秒）；镜头之间动作与构图要连续衔接。"
        "优先挑选最关键的 9 个节拍，形成一个可做成 12–15 秒短片的“浓缩版剧情”。\n"
        f"风格：{style}。\n"
        "角色一致性：主要人物必须保持同一张脸、同一发型、同一服装（参考上游角色三视图）。\n"
        "PG-13：冲突与恐怖用影子/反应镜头/切走/声场暗示，不要血腥与直白扑脸。\n"
        f"目标总时长：{duration_seconds} 秒。\n\n"
        f"故事文本（可裁剪提炼，不要照抄原文长段落）：\n{excerpt}\n"
    )
    negative = (
        "写实3D，真人照片感，血腥恐怖特写，怪物实体化扑脸，低俗惊吓，过度夸张超大眼Q版，人物跑脸换装，"
        "镜头间角色比例漂移，复杂彩色背景，文字水印"
    )
    return prompt, negative


def _call_openai_structured(model: str, prompt: str, schema_model):
    """Call OpenAI Responses API and parse into Pydantic model."""
    client: OpenAI | None = None
    text = ""
    first_exc: Exception | None = None
    try:
        client = get_openai_client()
    except Exception as exc:
        first_exc = exc
        debug_openai_error(f"{schema_model.__name__} client_init", exc)
    # Preferred: Responses API (best quality for structured JSON). Fallback: Chat Completions for proxy compatibility.
    try:
        if client is None:
            raise first_exc or ValueError("OpenAI client is unavailable.")
        response = client.responses.create(
            model=model,
            input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
            text={
                "format": {
                    "type": "json_schema",
                    "name": schema_model.__name__,
                    "schema": schema_model.model_json_schema(),
                    "strict": True,
                }
            },
            stream=True,
        )
        debug_openai_response(f"{schema_model.__name__}", response)
        text = _collect_stream_text(response)
    except Exception as exc:
        first_exc = exc
        debug_openai_error(f"{schema_model.__name__} responses", exc)
        try:
            if client is None:
                raise first_exc or ValueError("OpenAI client is unavailable.")
            forced = (
                prompt.strip()
                + "\n\nIMPORTANT: Return ONLY a single JSON object matching this schema:\n"
                + json.dumps(schema_model.model_json_schema(), ensure_ascii=False)
            )
            chat = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": forced}],
                temperature=0,
            )
            msg = chat.choices[0].message
            text = str(getattr(msg, "content", "") or "")
        except Exception as exc2:
            debug_openai_error(f"{schema_model.__name__} chat_fallback", exc2)
            text = ""
    try:
        return schema_model.model_validate_json(text)
    except Exception as exc:
        # Fallback: if provider ignores JSON format, try to construct minimal valid payload
        if schema_model.__name__ == "RoleDecision":
            raw = (text or "").strip()
            mapping = role_map()
            chosen_id = None
            raw_lower = raw.lower()
            for rid, role in mapping.items():
                if rid in raw_lower or role["name"].lower() in raw_lower:
                    chosen_id = rid
                    break
            resolved_id = normalize_role_id(chosen_id or DEFAULT_ROLE_ID)
            profile = mapping.get(resolved_id, mapping[DEFAULT_ROLE_ID])
            reason = f"Fallback parse from model output: {raw[:120] or '无理由'}"
            if first_exc is not None and not raw:
                reason = f"Fallback due to OpenAI error: {_format_openai_error(first_exc).get('message', '')}"
            return schema_model(
                role_id=resolved_id,
                role_name=profile["name"],
                reason=reason,
            )
        raise ValueError(f"Failed to parse model output as {schema_model.__name__}: {text}") from exc


def _extract_openai_text(response) -> str:
    """Best-effort text extraction from OpenAI responses API."""
    try:
        if getattr(response, "output_text", None):
            return response.output_text
    except Exception:
        pass
    try:
        output = getattr(response, "output", None) or []
        if output:
            first = output[0]
            content = getattr(first, "content", None) or []
            for block in content:
                text = getattr(block, "text", None)
                if text:
                    return text
                if hasattr(block, "output_text") and getattr(block, "output_text"):
                    return getattr(block, "output_text")
                if isinstance(block, dict):
                    if block.get("text"):
                        return block["text"]
                    if block.get("output_text"):
                        return block["output_text"]
    except Exception:
        pass
    return ""


def _tool_definitions_for_canvas() -> list[dict]:
    """Expose canvas tools to the LLM for function calling (frontends will execute).

    NOTE: Responses API expects function tools in the flat shape:
    {type: 'function', name, description?, parameters, strict?}
    """
    config_schema = {
        "type": "object",
        "description": "节点 data 配置（会写入 node.data）。常用字段：kind、prompt、negativePrompt、systemPrompt、keywords、imageModel/videoModel 等。",
        "properties": {
            "kind": {
                "type": "string",
                "description": "任务类型（通常由 type 推导），例如 image/textToImage/composeVideo/video。",
            },
            "prompt": {"type": "string", "description": "主提示词"},
            "negativePrompt": {"type": "string", "description": "负面提示词"},
            "systemPrompt": {"type": "string", "description": "系统提示词/风格基准"},
            "keywords": {
                "type": ["string", "array"],
                "items": {"type": "string"},
                "description": "关键词（可用逗号分隔字符串或数组）",
            },
            "imageModel": {"type": "string", "description": "图像模型（可选）"},
            "videoModel": {"type": "string", "description": "视频模型（可选）"},
        },
        "additionalProperties": True,
    }
    return [
        {
            "type": "function",
            "name": "createNode",
            "description": "创建画布节点（仅支持 image/textToImage/composeVideo/video）。config 会写入 node.data。",
            "strict": False,
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["image", "textToImage", "composeVideo", "video"],
                        "description": "逻辑节点类型（前端会映射成 taskNode.kind）",
                    },
                    "label": {"type": "string", "description": "可选：节点标签"},
                    "config": config_schema,
                    "remixFromNodeId": {
                        "type": "string",
                        "description": "可选：基于已有视频节点做 Remix（传入源节点 ID）",
                    },
                    "position": {
                        "type": "object",
                        "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                        "required": ["x", "y"],
                        "additionalProperties": False,
                        "description": "可选：节点位置",
                    },
                },
                "required": ["type"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "updateNode",
            "description": "更新已存在节点的配置或标签，通常用于写入/修改 prompt。",
            "strict": False,
            "parameters": {
                "type": "object",
                "properties": {
                    "nodeId": {
                        "type": "string",
                        "description": "节点 ID（也可直接传节点 label；前端会按 label 解析）",
                    },
                    "label": {"type": "string", "description": "可选：新标签"},
                    "config": config_schema,
                },
                "required": ["nodeId"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "connectNodes",
            "description": "连接两个节点，source -> target。",
            "strict": False,
            "parameters": {
                "type": "object",
                "properties": {
                    "sourceNodeId": {
                        "type": "string",
                        "description": "源节点 ID（也可直接传节点 label；前端会按 label 解析）",
                    },
                    "targetNodeId": {
                        "type": "string",
                        "description": "目标节点 ID（也可直接传节点 label；前端会按 label 解析）",
                    },
                    "sourceHandle": {"type": "string", "description": "可选：源手柄"},
                    "targetHandle": {"type": "string", "description": "可选：目标手柄"},
                },
                "required": ["sourceNodeId", "targetNodeId"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "runNode",
            "description": "执行一个节点（例如 composeVideo/image），前端自行处理执行细节。",
            "strict": False,
            "parameters": {
                "type": "object",
                "properties": {
                    "nodeId": {
                        "type": "string",
                        "description": "节点 ID（也可直接传节点 label；前端会按 label 解析）",
                    },
                },
                "required": ["nodeId"],
                "additionalProperties": False,
            },
        },
    ]


def _tool_definitions_for_role(role_id: str, allow_canvas_tools: bool) -> list[dict]:
    """Return tool definitions filtered by role permissions and the decision-layer gate."""
    if not allow_canvas_tools:
        return []
    resolved_id = normalize_role_id(role_id or DEFAULT_ROLE_ID)
    allowed = ROLE_ALLOWED_CANVAS_TOOLS.get(resolved_id, set())
    if not allowed:
        return []
    return [t for t in _tool_definitions_for_canvas() if t.get("name") in allowed]


def _filter_tool_calls_by_role(tool_calls: list[dict], role_id: str, allow_canvas_tools: bool) -> list[dict]:
    if not allow_canvas_tools:
        return []
    resolved_id = normalize_role_id(role_id or DEFAULT_ROLE_ID)
    allowed = ROLE_ALLOWED_CANVAS_TOOLS.get(resolved_id, set())
    if not allowed:
        return []
    filtered: list[dict] = []
    for c in tool_calls or []:
        if not isinstance(c, dict):
            continue
        name = c.get("name")
        if name in allowed:
            filtered.append(c)
    return filtered


def _resolve_role(role_id: str):
    """Return a validated role id and its profile."""
    resolved_id = normalize_role_id(role_id)
    mapping = role_map()
    profile = mapping.get(resolved_id, mapping[DEFAULT_ROLE_ID])
    return resolved_id, profile


def _tail_messages(messages: list, limit: int) -> list:
    if not isinstance(messages, list) or limit <= 0:
        return []
    if len(messages) <= limit:
        return messages
    return messages[-limit:]


def _render_compact_conversation(state: OverallState, *, tail: int = 16) -> str:
    """Render a compact conversation string for prompts.

    Prefer the durable `conversation_summary` (if present), plus the most recent turns.
    This keeps role selection stable without exploding prompt length on long chats.
    """
    summary = state.get("conversation_summary")
    tail_messages = _tail_messages(state.get("messages") or [], tail)
    recent = format_messages_for_prompt(tail_messages)
    if isinstance(summary, str) and summary.strip():
        if recent.strip():
            return f"Conversation summary:\n{summary.strip()}\n\nRecent turns:\n{recent}".strip()
        return summary.strip()
    return recent


def _get_research_topic_with_summary(state: OverallState, *, tail: int = 16) -> str:
    summary = state.get("conversation_summary")
    topic = get_research_topic(_tail_messages(state.get("messages") or [], tail))
    if isinstance(summary, str) and summary.strip():
        s = summary.strip()
        if isinstance(topic, str) and topic.strip():
            return f"Conversation summary:\n{s}\n\nRecent conversation:\n{topic}".strip()
        return s
    return topic


# Nodes
def select_role(state: OverallState, config: RunnableConfig) -> OverallState:
    """Pick the active assistant role based on the latest conversation."""
    configurable = Configuration.from_runnable_config(config)
    llm_provider = resolve_llm_provider(configurable.llm_provider)
    interaction_mode = state.get("interaction_mode")
    if interaction_mode not in ("agent", "agent_max", "plan"):
        interaction_mode = "agent"
    conversation = _render_compact_conversation(state, tail=16)
    canvas_context = state.get("canvas_context")
    canvas_context_text = _render_canvas_context_for_prompt(canvas_context)
    prompt = role_router_instructions.format(
        roles_block=roles_prompt_block(),
        default_role_id=DEFAULT_ROLE_ID,
        conversation=conversation,
        canvas_context=canvas_context_text,
    )

    if llm_provider == "openai":
        result = _call_openai_structured(
            configurable.role_selector_model,
            prompt,
            RoleDecision,
        )
    else:
        require_gemini_key()
        llm = ChatGoogleGenerativeAI(
            model=configurable.role_selector_model,
            temperature=0,
            max_retries=2,
            api_key=get_gemini_api_key(),
        )
        result = llm.with_structured_output(RoleDecision).invoke(prompt)

    resolved_id, profile = _resolve_role(result.role_id)
    reason = result.reason or "基于对话意图的默认选择。"
    allow_canvas_tools = bool(getattr(result, "allow_canvas_tools", True))
    allow_canvas_tools_reason = (
        getattr(result, "allow_canvas_tools_reason", None) or "根据用户意图判断。"
    )
    tool_tier = getattr(result, "tool_tier", "none") or "none"
    intent = getattr(result, "intent", None)

    # Enforce mutually-exclusive tiers.
    if allow_canvas_tools:
        tool_tier = "canvas"
    elif isinstance(tool_tier, str) and tool_tier.lower() == "canvas":
        tool_tier = "none"
    if isinstance(tool_tier, str) and tool_tier.lower() in ("web", "rag"):
        # This agent uses RAG (KB retrieval) only; external web search is disallowed.
        tool_tier = "rag"
        allow_canvas_tools = False
        allow_canvas_tools_reason = "本轮为知识库检索（RAG）意图，禁用画布工具以保持互斥。"

    # Interaction mode override:
    # - agent: prefer self-executing canvas tools (avoid repeated confirmations).
    # - plan: keep conservative behavior (confirmations/gates may apply).
    if interaction_mode in ("agent", "agent_max"):
        allow_canvas_tools = True
        allow_canvas_tools_reason = (
            "Agent Max 模式：允许自执行画布工具（包含图片/视频自动执行）。"
            if interaction_mode == "agent_max"
            else "Agent 模式：允许自执行画布工具（尽量不反复询问）。"
        )
        tool_tier = "canvas"

    # Safety fallback (heuristic, not strict string matching):
    # For very short, low-information user turns that do not contain any creation intent,
    # default to not executing canvas tools in this turn.
    try:
        last_user_text = ""
        for m in reversed(state.get("messages") or []):
            if getattr(m, "type", None) == "human" or getattr(m, "role", None) == "user":
                last_user_text = str(getattr(m, "content", "") or "")
                break
        t = (last_user_text or "").strip()
        # Collapse whitespace
        t_compact = " ".join(t.split())

        if interaction_mode == "plan" and allow_canvas_tools:
            explicit_execute_hints = (
                "不用确认",
                "不必确认",
                "别问",
                "直接执行",
                "直接生成",
                "自动执行",
                "自执行",
                "run",
                "tool",
            )
            if not any(k in t_compact for k in explicit_execute_hints):
                allow_canvas_tools = False
                allow_canvas_tools_reason = "Plan 模式：按步骤询问确认，本轮不自动执行画布工具。"
                tool_tier = "none"

        creation_hints = (
            "生成",
            "创建",
            "画",
            "做",
            "帮",
            "续写",
            "分镜",
            "故事板",
            "九宫格",
            "视频",
            "图片",
            "改",
            "调整",
            "修改",
            "连接",
            "运行",
        )
        if (
            interaction_mode == "plan"
            and allow_canvas_tools
            and t_compact
            and len(t_compact) <= 8
            and not any(k in t_compact for k in creation_hints)
        ):
            allow_canvas_tools = False
            allow_canvas_tools_reason = "用户输入过短且未表达明确创作动作，先用选项确认下一步。"
    except Exception:
        pass

    # ensure defaults for downstream (even though web research removed)
    defaults = {
        "search_query": [],
        "web_research_result": [],
        "sources_gathered": [],
        "initial_search_query_count": state.get("initial_search_query_count", 0),
        "max_research_loops": state.get("max_research_loops", 0),
        "agent_loop_count": state.get("agent_loop_count", 0),
    }

    return {
        "active_role": resolved_id,
        "active_role_name": profile["name"],
        "active_role_reason": reason,
        "allow_canvas_tools": allow_canvas_tools,
        "allow_canvas_tools_reason": allow_canvas_tools_reason,
        "interaction_mode": interaction_mode,
        "active_intent": intent or "",
        "active_tool_tier": tool_tier,
        **{k: v for k, v in defaults.items() if k not in state},
    }


# Nodes
def finalize_answer(state: OverallState, config: RunnableConfig):
    """LangGraph node that finalizes the research summary.

    Prepares the final output by deduplicating and formatting sources, then
    combining them with the running summary to create a well-structured
    research report with proper citations.

    Args:
        state: Current graph state containing the running summary and sources gathered

    Returns:
        Dictionary with state update, including running_summary key containing the formatted final summary with sources
    """
    configurable = Configuration.from_runnable_config(config)
    llm_provider = resolve_llm_provider(configurable.llm_provider)
    reasoning_model = state.get("reasoning_model") or configurable.answer_model
    agent_loop_count = int(state.get("agent_loop_count", 0) or 0) + 1
    hard_turn_cap = int(getattr(configurable, "hard_max_turn_loops", 10) or 10)
    state["agent_loop_count"] = agent_loop_count

    # Resolve role directive for persona-aware answer.
    # Always include an "art director" supervision rubric, even when a specialist role is active.
    resolved_id, profile = _resolve_role(state.get("active_role", DEFAULT_ROLE_ID))
    director_id, director_profile = _resolve_role("art_director")
    role_directive = (
        f"总监审查（{director_profile['name']}｜{director_id}）: {director_profile['summary']}。"
        f" 审查风格：{director_profile['style']}。"
        f" 你必须先审查本轮是否应该执行画布动作（tool calls）、是否需要用户确认、是否保持风格/上下文一致，再输出最终回复。\n"
        f"主执行角色（{profile['name']}｜{resolved_id}）: {profile['summary']}。回复风格：{profile['style']}。"
        f" 选择原因：{state.get('active_role_reason', '根据对话意图选择。')}"
    )

    # Format the prompt
    current_date = get_current_date()
    canvas_context = state.get("canvas_context")
    canvas_context_text = _render_canvas_context_for_prompt(canvas_context)
    interaction_mode = state.get("interaction_mode")
    if interaction_mode not in ("agent", "agent_max", "plan"):
        interaction_mode = "agent"
    formatted_prompt = answer_instructions.format(
        current_date=current_date,
        interaction_mode=interaction_mode,
        research_topic=_get_research_topic_with_summary(state, tail=16),
        role_directive=role_directive,
        summaries="\n---\n\n".join(state["web_research_result"]),
        canvas_context=canvas_context_text,
    )
    tool_calls_payload: list[dict] = []
    llm_error_payload: dict | None = None
    quick_replies_payload: list[dict] | None = None

    def _extract_tapcanvas_actions(text: str) -> tuple[str, list[dict] | None]:
        if not isinstance(text, str):
            return text, None

        def _normalize_actions(obj: object) -> list[dict] | None:
            actions = obj.get("actions") if isinstance(obj, dict) else None
            if not isinstance(actions, list):
                return None
            normalized: list[dict] = []
            for item in actions:
                if not isinstance(item, dict):
                    continue
                label = item.get("label")
                input_text = item.get("input")
                if not isinstance(label, str) or not label.strip():
                    continue
                if not isinstance(input_text, str) or not input_text.strip():
                    continue
                normalized.append({"label": label.strip(), "input": input_text})
                if len(normalized) >= 6:
                    break
            return normalized or None

        def _extract_json_object(s: str, start_index: int) -> tuple[str, int] | None:
            """Return (json_text, end_index_exclusive) for a JSON object starting at/after start_index."""
            start = s.find("{", start_index)
            if start < 0:
                return None
            depth = 0
            in_string = False
            quote = ""
            i = start
            while i < len(s):
                ch = s[i]
                if in_string:
                    if ch == "\\":
                        i += 2
                        continue
                    if ch == quote:
                        in_string = False
                        quote = ""
                    i += 1
                    continue
                if ch in ('"', "'"):
                    in_string = True
                    quote = ch
                    i += 1
                    continue
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        return s[start : i + 1].strip(), i + 1
                i += 1
            return None

        cleaned = text
        obj: object | None = None

        # Preferred: fenced block (per prompt convention).
        marker = "```tapcanvas_actions"
        start = text.find(marker)
        if start >= 0:
            start_payload = text.find("\n", start + len(marker))
            if start_payload >= 0:
                start_payload += 1
                end_fence = text.find("```", start_payload)
                if end_fence >= 0:
                    payload_raw = text[start_payload:end_fence].strip()
                    cleaned = (text[:start] + text[end_fence + 3 :]).strip()
                    try:
                        obj = json.loads(payload_raw)
                    except Exception:
                        obj = None

        # Fallback: plain marker + JSON (some models omit the code fence and may append extra text after JSON).
        if obj is None and "tapcanvas_actions" in text:
            token = "tapcanvas_actions"
            token_idx = text.find(token)
            while token_idx >= 0:
                if token_idx == 0 or text[token_idx - 1] == "\n":
                    break
                token_idx = text.find(token, token_idx + len(token))
            if token_idx >= 0:
                extracted = _extract_json_object(text, token_idx + len(token))
                if extracted:
                    payload_raw, end_index = extracted
                    remove_start = token_idx - 1 if token_idx > 0 and text[token_idx - 1] == "\n" else token_idx
                    cleaned = (text[:remove_start] + text[end_index:]).strip()
                    try:
                        obj = json.loads(payload_raw)
                    except Exception:
                        obj = None

        if obj is None:
            return cleaned, None

        normalized = _normalize_actions(obj)
        return cleaned, normalized

    allow_canvas_tools = bool(state.get("allow_canvas_tools", True))
    role_tools = _tool_definitions_for_role(resolved_id, allow_canvas_tools)

    # Fast path: when user pastes a long story in Agent/Agent Max, deterministically run
    # the character->storyboard->video pipeline instead of relying on the LLM to emit tool calls.
    # This avoids truncated tool-call JSON and makes the workflow repeatable/dedupable.
    try:
        last_user_text = _get_last_user_text(state)
        if (
            allow_canvas_tools
            and interaction_mode in ("agent", "agent_max")
            and _looks_like_story_request(last_user_text)
            and not any(
                k in (last_user_text or "")
                for k in (
                    "先不操作画布",
                    "不要操作画布",
                    "只聊",
                    "只写",
                    "不要生成",
                    "不生成",
                )
            )
        ):
            tool_calls_payload, content = _synthesize_story_pipeline_tool_calls(
                state,
                configurable,
                interaction_mode=interaction_mode,
                story_text=last_user_text,
            )
            message_kwargs = {
                "active_role": resolved_id,
                "active_role_name": profile["name"],
                "active_role_reason": state.get("active_role_reason", "根据对话意图选择。"),
                "active_intent": state.get("active_intent", ""),
                "active_tool_tier": state.get("active_tool_tier", "canvas"),
                "allow_canvas_tools": True,
                "allow_canvas_tools_reason": state.get("allow_canvas_tools_reason", ""),
                "tool_calls": tool_calls_payload,
            }
            return {
                "messages": [AIMessage(content=content, additional_kwargs=message_kwargs)],
                "sources_gathered": state.get("sources_gathered", []) or [],
                "active_role": resolved_id,
                "active_role_name": profile["name"],
                "active_role_reason": state.get("active_role_reason", "根据对话意图选择。"),
                "active_intent": state.get("active_intent", ""),
                "active_tool_tier": "canvas",
                "agent_loop_count": agent_loop_count,
            }
    except Exception:
        pass

    if llm_provider == "openai":
        try:
            kwargs: dict = {
                "model": reasoning_model,
                "input": [
                    {
                        "role": "user",
                        "content": [{"type": "input_text", "text": formatted_prompt}],
                    }
                ],
                "stream": True,
            }
            if role_tools:
                kwargs["tools"] = role_tools
                kwargs["tool_choice"] = "auto"
            try:
                completion = get_openai_client().responses.create(**kwargs)
                debug_openai_response("finalize_answer", completion)
                result_text, tool_calls_payload = _collect_stream_text_and_tools(completion)
                tool_calls_payload = _normalize_tool_calls_payload(tool_calls_payload)
                tool_calls_payload = _filter_tool_calls_by_role(tool_calls_payload, resolved_id, allow_canvas_tools)
            except Exception as exc:
                # Fallback for OpenAI-compatible proxies that don't implement Responses API.
                debug_openai_error("finalize_answer responses_fallback", exc)
                client = get_openai_client()
                chat_kwargs: dict = {
                    "model": reasoning_model,
                    "messages": [{"role": "user", "content": formatted_prompt}],
                    "temperature": 0,
                }
                chat_tools = _to_chat_completions_tools(role_tools)
                if chat_tools:
                    chat_kwargs["tools"] = chat_tools
                    chat_kwargs["tool_choice"] = "auto"
                chat = client.chat.completions.create(**chat_kwargs)
                msg = chat.choices[0].message
                result_text = str(getattr(msg, "content", "") or "")
                tool_calls_payload = _parse_chat_completions_tool_calls(msg)
                tool_calls_payload = _normalize_tool_calls_payload(tool_calls_payload)
                tool_calls_payload = _filter_tool_calls_by_role(tool_calls_payload, resolved_id, allow_canvas_tools)

            # Story -> characters -> storyboard -> video autopipeline
            # Trigger when user pastes long story text and asks for animation/storyboard/video.
            try:
                last_user_text = _get_last_user_text(state)
                if (
                    allow_canvas_tools
                    and interaction_mode in ("agent", "agent_max")
                    and _looks_like_story_request(last_user_text)
                ):
                    tool_calls_payload, result_text = _synthesize_story_pipeline_tool_calls(
                        state,
                        configurable,
                        interaction_mode=interaction_mode,
                        story_text=last_user_text,
                    )
            except Exception:
                pass

            # AgentMax fallback: if the user explicitly asks for character turnarounds (三视图)
            # but the model returned no tool calls, synthesize minimal character-ref nodes.
            # This prevents "explaining prompts" loops when the intent is clearly generation.
            if (
                interaction_mode in ("agent_max",)
                and allow_canvas_tools
                and not tool_calls_payload
            ):
                try:
                    last_user_text = ""
                    try:
                        for m in reversed(state.get("messages") or []):
                            if getattr(m, "type", None) == "human" or getattr(m, "role", None) == "user":
                                last_user_text = str(getattr(m, "content", "") or "")
                                break
                    except Exception:
                        last_user_text = ""
                    t = (last_user_text or "").strip()
                    if any(k in t for k in ("三视", "三视图", "角色三视", "角色三视图")):
                        # Infer character names from recent user text (best-effort).
                        recent_user_text = ""
                        try:
                            user_msgs = []
                            for m in (state.get("messages") or [])[-12:]:
                                if getattr(m, "type", None) == "human" or getattr(m, "role", None) == "user":
                                    user_msgs.append(str(getattr(m, "content", "") or ""))
                            recent_user_text = "\n".join(user_msgs)
                        except Exception:
                            recent_user_text = t

                        candidates: list[str] = []
                        for name in ("李长安", "李老头"):
                            if name in recent_user_text:
                                candidates.append(name)
                        if "开发商" in recent_user_text:
                            candidates.append("开发商")
                        if "黑西装" in recent_user_text:
                            candidates.append("黑西装老大")
                        # De-dup, keep order.
                        seen = set()
                        names: list[str] = []
                        for n in candidates:
                            if n in seen:
                                continue
                            seen.add(n)
                            names.append(n)
                        if not names:
                            names = ["主角"]

                        def _three_view_prompt(n: str) -> str:
                            return (
                                "日漫2D角色设定图，三视图同画面（正面/侧面/背面），全身站姿，比例统一，三视同一身高与肩宽，脸型五官一致，"
                                "发型轮廓一致；线条干净，赛璐璐平涂，少量高光与阴影；纯浅灰背景；脚底对齐同一地面线；"
                                "清晰服装结构与褶皱逻辑；适合后续分镜复用。\n"
                                f"角色：{n}。\n"
                                "风格：民俗志怪+现实荒诞的日漫2D，克制写实（非Q版）。\n"
                                "要求：不要换脸、不要换衣服、不要改变发型分缝；三视一致。"
                            )

                        negative = (
                            "写实3D, 真人照片风, Q版, 夸张大眼幼态, 换脸, 换发型, 换衣服, 多余人物, 多张脸, "
                            "背景复杂, 血腥细节, 肢体缺失, 手指畸形"
                        )

                        synthesized: list[dict] = []
                        for n in names[:6]:
                            label = f"角色三视图-{n}"
                            synthesized.append(
                                {
                                    "name": "createNode",
                                    "arguments": {
                                        "type": "image",
                                        "label": label,
                                        "config": {
                                            "kind": "image",
                                            "prompt": _three_view_prompt(n),
                                            "negativePrompt": negative,
                                        },
                                    },
                                }
                            )
                            synthesized.append({"name": "runNode", "arguments": {"nodeId": label}})
                        tool_calls_payload = synthesized
                except Exception:
                    pass

            # If the user is asking for open-ended story continuation recommendations,
            # do NOT auto-create storyboard/video nodes in this turn; offer selectable directions.
            last_user_text = ""
            try:
                for m in reversed(state.get("messages") or []):
                    if getattr(m, "type", None) == "human" or getattr(m, "role", None) == "user":
                        last_user_text = str(getattr(m, "content", "") or "")
                        break
            except Exception:
                last_user_text = ""

            # Always-on "magician" content safety:
            # - Safety classification should be decided by an LLM (not brittle keyword lists).
            # - We only use lightweight sanitization transforms AFTER classification.
            def _classify_safety(user_text: str, planned_prompts: str) -> SafetyDecision:
                model = getattr(configurable, "safety_classifier_model", None) or configurable.role_selector_model
                payload = (
                    "You are a strict-but-practical content safety classifier for a public creative tool.\n"
                    "Task: judge whether the request/planned prompts contain explicit sexual content, explicit nudity, graphic gore, or explicit violence.\n"
                    "Rules:\n"
                    "- sexual=true only for explicit sexual acts/pornographic intent.\n"
                    "- nudity=true if explicit nudity is requested or described for output.\n"
                    "- gore=true only for graphic body harm/viscera/dismemberment close-ups.\n"
                    "- violence=true for explicit harm descriptions that should be softened to PG-13 cinematic implication.\n"
                    "- should_block=true if the assistant must refuse direct generation and ask to rewrite first (typically sexual/porn; or extreme gore).\n"
                    "- should_sanitize=true if output should be rewritten/softened (PG-13) before proceeding.\n"
                    "Return a JSON object matching the provided schema.\n\n"
                    "USER_TEXT:\n"
                    f"{(user_text or '').strip()}\n\n"
                    "PLANNED_PROMPTS (may be empty):\n"
                    f"{(planned_prompts or '').strip()}\n"
                )
                try:
                    return _call_openai_structured(model, payload, SafetyDecision)
                except Exception:
                    # Fallback: assume safe but keep sanitization enabled in prompts via negativePrompt.
                    return SafetyDecision(
                        sexual=False,
                        nudity=False,
                        gore=False,
                        violence=False,
                        should_block=False,
                        should_sanitize=True,
                        reason="Fallback: classifier unavailable.",
                    )

            def _sanitize_sexual_text(text: str) -> str:
                if not isinstance(text, str) or not text.strip():
                    return text
                replacements = {
                    "无码": "（不展示细节）",
                    "露点": "穿着完整（不露骨）",
                    "裸体": "穿着完整（不露骨）",
                    "性交": "亲密互动（不露骨）",
                    "做爱": "亲密互动（不露骨）",
                    "口交": "亲密互动（不露骨）",
                    "肛交": "亲密互动（不露骨）",
                    "强奸": "性侵（不展示细节，仅点到为止）",
                    "迷奸": "性侵（不展示细节，仅点到为止）",
                    "porn": "（不露骨）",
                }
                out = text
                for k, v in replacements.items():
                    out = out.replace(k, v)
                return out

            def _sanitize_violent_text(text: str) -> str:
                if not isinstance(text, str) or not text.strip():
                    return text
                replacements = {
                    "爆头": "强烈冲击（不展示细节）",
                    "脑浆": "冲击性的后果（不展示细节）",
                    "断肢": "受伤倒下（不展示细节）",
                    "肢解": "镜头切走（用暗示表达）",
                    "开膛": "镜头切走（用暗示表达）",
                    "剖腹": "镜头切走（用暗示表达）",
                    "内脏": "不展示细节",
                    "肠子": "不展示细节",
                    "碎尸": "不展示细节",
                    "割喉": "镜头切走（用暗示表达）",
                    "斩首": "镜头切走（用暗示表达）",
                    "砍头": "镜头切走（用暗示表达）",
                    "喷血": "用剪影/反应镜头表达冲击（不展示细节）",
                    "血浆": "用光影/音效表达冲击（不展示细节）",
                    "血肉模糊": "画面用遮挡/虚焦表达（不展示细节）",
                }
                out = text
                for k, v in replacements.items():
                    out = out.replace(k, v)
                return out

            tool_prompts_text = ""
            try:
                for c in tool_calls_payload or []:
                    if c.get("name") != "createNode":
                        continue
                    args = c.get("arguments") or {}
                    cfg = args.get("config")
                    if isinstance(cfg, dict):
                        p = cfg.get("prompt")
                        if isinstance(p, str) and p.strip():
                            tool_prompts_text += "\n" + p
            except Exception:
                pass
            safety = _classify_safety(last_user_text or "", tool_prompts_text)

            if safety.should_block and (safety.sexual or safety.nudity):
                tool_calls_payload = []
                quick_replies_payload = [
                    {
                        "label": "改成含蓄浪漫（不露骨）",
                        "input": "把刚才的内容改写成含蓄浪漫、PG-13表达：不出现裸体/性行为/露骨描写，用暗示与情绪推进；然后再生成九宫格分镜。",
                    },
                    {
                        "label": "改成亲密但克制",
                        "input": "把亲密内容改成拥抱/牵手/靠近等克制表达（不涉及色情），强调关系与情绪；然后再生成分镜/视频。",
                    },
                    {
                        "label": "只保留剧情，不生成画面",
                        "input": "先不要生成画面。把内容改成适合大众平台的剧情梗概（不露骨），并给我3个可选走向按钮。",
                    },
                    {
                        "label": "我只是要分镜（无色情）",
                        "input": "我这段没有色情/裸露/性行为内容，只是要做分镜与提示词；请按原剧情继续生成九宫格分镜与统一提示词，并在提示词里明确：无裸露、无性行为、PG-13。",
                    },
                ]
                result_text = (
                    "内容安全检查判定为需要先降级到 PG-13（不露骨、不裸露）。"
                    "我不会生成露骨色情内容；可以先把表达改成含蓄、电影化暗示再继续做分镜/视频。点一个按钮继续。"
                )
            elif safety.should_sanitize and (safety.sexual or safety.nudity):
                # Sanitize prompts and add safety negatives, but do not hard-block the whole turn.
                try:
                    for c in tool_calls_payload or []:
                        if c.get("name") != "createNode":
                            continue
                        args = c.get("arguments") or {}
                        cfg = args.get("config")
                        if not isinstance(cfg, dict):
                            continue
                        if isinstance(cfg.get("prompt"), str):
                            cfg["prompt"] = _sanitize_sexual_text(cfg["prompt"])
                        neg = cfg.get("negativePrompt")
                        neg_text = neg if isinstance(neg, str) else ""
                        add_neg = "nude, naked, explicit sex, porn, nipples, genitalia"
                        if add_neg not in neg_text:
                            cfg["negativePrompt"] = (neg_text + ("\n" if neg_text else "") + add_neg).strip()
                except Exception:
                    pass
            elif safety.should_sanitize and (safety.gore or safety.violence):
                result_text = _sanitize_violent_text(result_text or "")
                try:
                    for c in tool_calls_payload or []:
                        if c.get("name") != "createNode":
                            continue
                        args = c.get("arguments") or {}
                        cfg = args.get("config")
                        if not isinstance(cfg, dict):
                            continue
                        if isinstance(cfg.get("prompt"), str):
                            cfg["prompt"] = _sanitize_violent_text(cfg["prompt"])
                        neg = cfg.get("negativePrompt")
                        neg_text = neg if isinstance(neg, str) else ""
                        add_neg = "gore, dismemberment, intestines, brains, blood splatter close-up, explicit violence, torture porn, nude, explicit sex"
                        if add_neg not in neg_text:
                            cfg["negativePrompt"] = (neg_text + ("\n" if neg_text else "") + add_neg).strip()
                except Exception:
                    pass
            is_story_suggestion_request = (
                any(k in (last_user_text or "") for k in ("续写", "后续剧情", "接下来", "续作"))
                and any(k in (last_user_text or "") for k in ("推荐", "方向", "灵感", "怎么写"))
                and not any(k in (last_user_text or "") for k in ("九宫格", "分镜", "故事板", "storyboard", "15s"))
            )

            if (
                interaction_mode == "plan"
                and is_story_suggestion_request
                and "tapcanvas_actions" not in (result_text or "")
            ):
                # Prevent unintended canvas actions triggered by the model.
                tool_calls_payload = []
                quick_replies_payload = [
                    {
                        "label": "方向A：暖心日常",
                        "input": "我选择方向A（暖心日常）：请基于当前项目已有剧情与角色关系（沿用同一世界观/场景/氛围）续写下一段 15 秒的小故事。先给我紧凑剧情梗概（3-5句），再生成九宫格分镜（image）并连接到15s视频（composeVideo）。",
                    },
                    {
                        "label": "方向B：轻冒险任务",
                        "input": "我选择方向B（轻冒险任务）：请基于当前项目已有剧情续写，加入一个小目标/小危机但保持治愈基调。先给剧情梗概（3-5句），再生成九宫格分镜（image）并连接到15s视频（composeVideo）。",
                    },
                    {
                        "label": "方向C：小悬疑反转",
                        "input": "我选择方向C（小悬疑反转）：请基于当前项目已有剧情续写，前半段制造小谜团，结尾温暖反转（不要跳出既有设定）。先给剧情梗概（3-5句），再生成九宫格分镜（image）并连接到15s视频（composeVideo）。",
                    },
                    {
                        "label": "自定义方向…",
                        "input": "我想自定义续写方向（基于当前项目已有剧情，不要另起炉灶）：\n- 主题/情绪：\n- 场景：\n- 关键事件：\n- 结尾落点：\n请基于我的填写先给梗概，再做九宫格分镜与15s视频。",
                    },
                ]
                result_text = "给你 3 个续写方向，点一个我就按这个继续写；也可以选“自定义方向”把你想要的走向填进去。"

            # Storyboard/video continuity gate:
            # To avoid abrupt scene drift and accidental new subjects, require an explicit "lock" confirmation
            # before creating storyboard/video nodes, unless the user already confirmed.
            has_canvas_tool_calls = any(
                (c.get("name") in ("createNode", "updateNode", "connectNodes", "runNode"))
                for c in (tool_calls_payload or [])
                if isinstance(c, dict)
            )
            # Only treat it as "generation intent" when the user asks for storyboard/image/video output,
            # or when the model already emitted canvas tool calls. This avoids forcing lock-confirmation
            # for text-only deliverables like scripts, character sheets, or shot lists.
            storyboard_generation_intent = (
                has_canvas_tool_calls
                or any(k in (last_user_text or "") for k in ("九宫格", "分镜图", "故事板", "storyboard"))
                or (
                    any(k in (last_user_text or "") for k in ("生成", "出", "做成"))
                    and any(k in (last_user_text or "") for k in ("分镜", "九宫格", "故事板", "图片", "生图", "视频", "15s", "15秒"))
                )
            )
            has_lock_confirmation = any(
                k in (last_user_text or "")
                for k in ("确认锁定", "锁定场景", "锁定主体", "锁定风格", "确认风格", "风格锁定", "我确认", "确认：")
            )
            implicit_lock_confirmation = any(
                k in (last_user_text or "")
                for k in ("继续", "按你给的", "就按这个", "照这个来", "不用确认", "直接生成", "别问了")
            )
            # Hard fallback to prevent self-looping: after N turns in the same thread,
            # stop blocking on lock confirmation and proceed with default lock behavior.
            if hard_turn_cap > 0 and agent_loop_count >= hard_turn_cap:
                has_lock_confirmation = True
            if storyboard_generation_intent and implicit_lock_confirmation:
                has_lock_confirmation = True
            if interaction_mode in ("agent", "agent_max") and storyboard_generation_intent:
                # Agent mode: proceed without additional lock-confirm steps.
                has_lock_confirmation = True

            def _extract_style_lock_from_messages(messages_obj: list | None) -> str | None:
                if not isinstance(messages_obj, list):
                    return None
                for m in reversed(messages_obj):
                    # Prefer user confirmations
                    if getattr(m, "type", None) != "human" and getattr(m, "role", None) != "user":
                        continue
                    text = str(getattr(m, "content", "") or "")
                    if not text:
                        continue
                    for key in ("确认锁定风格：", "风格锁定：", "锁定风格："):
                        if key in text:
                            after = text.split(key, 1)[1].strip()
                            if not after:
                                continue
                            first_line = after.splitlines()[0].strip()
                            return first_line[:80] if first_line else None
                return None

            style_lock = _extract_style_lock_from_messages(state.get("messages") or [])
            if storyboard_generation_intent and not has_lock_confirmation and not is_story_suggestion_request:
                # Convert any accidental tool calls into a "plan" with buttons for user confirmation.
                tool_calls_payload = []
                if not quick_replies_payload:
                    if not style_lock:
                        quick_replies_payload = [
                            {
                                "label": "继续（锁定+先做角色设定图）",
                                "input": "确认锁定风格：日漫2D（干净线稿+赛璐璐）。场景沿用当前项目主场景（光线连续，不自由换景）；主体不新增（数量不变）。\n第一步：先为所有主要角色生成可复现的角色设定图/参考图（character/image 节点），并把这些参考图连到后续分镜节点作为引用。\n第二步：再生成 3x3 九宫格分镜图。",
                            },
                            {
                                "label": "锁定风格：美漫2D（粗线条）",
                                "input": "确认锁定风格：美漫2D（粗线条+高对比）。场景沿用当前项目主场景（光线连续，不自由换景）；主体不新增（数量不变）。\n第一步：先为所有主要角色生成可复现的角色设定图/参考图（character/image 节点），并把这些参考图连到后续分镜节点作为引用。\n第二步：再生成 3x3 九宫格分镜图。",
                            },
                            {
                                "label": "锁定风格：写实真人",
                                "input": "确认锁定风格：写实真人（电影质感）。场景沿用当前项目主场景（光线连续，不自由换景）；主体不新增（数量不变）。\n第一步：先为所有主要角色生成可复现的角色设定图/参考图（character/image 节点），并把这些参考图连到后续分镜节点作为引用。\n第二步：再生成 3x3 九宫格分镜图。",
                            },
                            {
                                "label": "自定义风格…",
                                "input": "确认锁定风格：\n- 风格类型（2D日漫/2D美漫/写实/其他）：\n- 线条/材质：\n- 色彩与光影：\n- 镜头语言：\n同时：场景沿用当前项目主场景（光线连续，不自由换景）；主体不新增（数量不变）。填写后请生成 3x3 九宫格分镜图并连线参考图。",
                            },
                        ]
                    else:
                        quick_replies_payload = [
                            {
                                "label": "继续（按已锁定风格生成分镜）",
                                "input": f"确认锁定风格：{style_lock}。确认锁定：场景沿用当前项目主场景（光线连续，不自由换景）；主体不新增（主角数量不变）。请把剧情压缩成 3x3 九宫格分镜图，并把参考图全部连到分镜节点上。",
                            },
                            {
                                "label": "新增主体…（先出设定图）",
                                "input": "我要新增主体（角色/产品/关键道具）：\n- 主体1：\n- 主体2：\n要求：先分别生成每个主体的设定图（image），等我确认后再生成九宫格分镜并连线消费这些设定图。",
                            },
                            {
                                "label": "改场景…（先锁定场景图）",
                                "input": "我想锁定新的主场景：\n- 场景描述：\n要求：先生成一张“场景设定图”（image）给我确认；确认后九宫格分镜必须只在该场景内推进（光线连续），再生成15s视频。",
                            },
                            {
                                "label": "自定义锁定规则…",
                                "input": "我想自定义锁定规则：\n- 主场景（只能一个）：\n- 允许的过渡场景（可选）：\n- 主体清单（角色/产品/道具）与数量：\n- 禁止事项：\n请按我的规则先补齐必要的设定图，再生成九宫格分镜并继续。",
                            },
                        ]
                if not isinstance(result_text, str) or not result_text.strip():
                    result_text = "为保证叙事连贯，我需要先锁定“主场景 + 主体数量/清单”。点一个选项确认后，我再在画布里生成九宫格分镜并继续成片。"
                else:
                    result_text = (
                        result_text.strip()
                        + "\n\n为保证叙事连贯（画风一致、场景不乱跳、主体不增删），请先确认锁定规则；或直接回复「继续」，我将按默认锁定（日漫2D/单主场景/主体不新增）生成九宫格分镜。"
                    )

            # Supervisor gate: only allow canvas side-effects when the router approved it for this turn.
            allow_canvas_tools = state.get("allow_canvas_tools")
            if allow_canvas_tools is False:
                tool_calls_payload = []
                if not quick_replies_payload:
                    quick_replies_payload = [
                        {
                            "label": "继续创作（先选方向）",
                            "input": "基于我当前项目画布，先给 3 个可选方向（按钮）让我选；我选完你再在画布创建分镜/视频节点。",
                        },
                        {
                            "label": "直接生成（我给具体需求）",
                            "input": "我想在画布生成一个内容：\n- 类型（图片/分镜/视频）：\n- 主题：\n- 风格：\n- 时长/比例（如需要）：\n请按我的填写创建节点并执行。",
                        },
                        {
                            "label": "只聊不操作画布",
                            "input": "先不操作画布。请先用一句话问我：我想做什么类型的内容、有什么参考、以及希望的风格/时长。",
                        },
                    ]
                if not isinstance(result_text, str) or not result_text.strip():
                    result_text = "我先不动画布。你想先聊清楚需求，还是直接点一个选项让我开始执行？"

            # Autopilot: if the model created an image node, also run it immediately.
            # The frontend can resolve nodeId from label, so we can safely reference labels here.
            if tool_calls_payload:
                # If this is a continuation turn and the assistant introduced a NEW character,
                # require user confirmation before generating storyboard/video.
                def _canvas_labels_from_context(canvas_context_obj: dict | None) -> set[str]:
                    if not isinstance(canvas_context_obj, dict):
                        return set()
                    nodes_ctx = canvas_context_obj.get("nodes")
                    if not isinstance(nodes_ctx, list):
                        return set()
                    labels: set[str] = set()
                    for n in nodes_ctx:
                        if not isinstance(n, dict):
                            continue
                        label = n.get("label")
                        if isinstance(label, str) and label.strip():
                            labels.add(label.strip())
                    return labels

                is_continuation_step = (
                    any(k in (last_user_text or "") for k in ("我选择方向", "自定义续写", "续写"))
                    and not is_story_suggestion_request
                )
                existing_labels = _canvas_labels_from_context(state.get("canvas_context"))
                created_image_labels: list[str] = []
                has_storyboard_create = False
                for c in tool_calls_payload:
                    if c.get("name") != "createNode":
                        continue
                    args = c.get("arguments") or {}
                    t = args.get("type")
                    label = args.get("label")
                    if isinstance(label, str):
                        label = label.strip()
                    else:
                        label = ""
                    if t == "image" and label:
                        created_image_labels.append(label)
                    if t == "image":
                        cfg = args.get("config") or {}
                        prompt = cfg.get("prompt") if isinstance(cfg, dict) else ""
                        hint = f"{label}\n{prompt}"
                        if any(k in hint for k in ("九宫格", "3x3", "分镜", "storyboard")):
                            has_storyboard_create = True

                # new character heuristic: created image node with label containing "角色" not previously on canvas
                new_character_labels = [
                    lbl
                    for lbl in created_image_labels
                    if ("角色" in lbl or "character" in lbl.lower())
                    and lbl not in existing_labels
                    and not any(k in lbl for k in ("分镜", "九宫格", "storyboard"))
                ]

                if is_continuation_step and new_character_labels and has_storyboard_create:
                    # Keep only new character creation + its runNode, drop other canvas ops for now.
                    kept: list[dict] = []
                    keep_set = set(new_character_labels)
                    for c in tool_calls_payload:
                        if c.get("name") == "createNode":
                            args = c.get("arguments") or {}
                            if (args.get("type") == "image") and isinstance(args.get("label"), str):
                                if args.get("label").strip() in keep_set:
                                    kept.append(c)
                            continue
                        if c.get("name") == "runNode":
                            args = c.get("arguments") or {}
                            node_id = args.get("nodeId")
                            if isinstance(node_id, str) and node_id.strip() in keep_set:
                                kept.append(c)
                            continue
                    tool_calls_payload = kept
                    # Ask user to confirm character result before proceeding.
                    quick_replies_payload = [
                        {
                            "label": "角色OK，继续分镜",
                            "input": "新角色我确认OK。请把新角色纳入同一项目设定，基于已有剧情续写下一段，并生成九宫格分镜（image）再连接到15s视频（composeVideo）。",
                        },
                        {
                            "label": "重做这个角色",
                            "input": "这个新角色不满意。请保持同一角色定位与风格，重做 3 个版本给我选（同一个 image 节点出 3 张即可）。",
                        },
                        {
                            "label": "不要新角色",
                            "input": "不要新增角色了。请只用现有角色基于已有剧情续写，并生成九宫格分镜与15s视频。",
                        },
                    ]
                    result_text = "我先为续写新增了一个角色设定图。你确认角色外观后，我再继续生成续写分镜。"

                # Normalize image creation: prefer `image` over `textToImage` to match the canvas UX.
                for call in tool_calls_payload:
                    if call.get("name") != "createNode":
                        continue
                    args = call.get("arguments") or {}
                    node_type = args.get("type")
                    if node_type != "textToImage":
                        continue
                    args["type"] = "image"
                    cfg = args.get("config")
                    if isinstance(cfg, dict) and cfg.get("kind") == "textToImage":
                        cfg["kind"] = "image"

                # Normalize composeVideo: ensure the node has a usable `prompt`.
                for call in tool_calls_payload:
                    if call.get("name") != "createNode":
                        continue
                    args = call.get("arguments") or {}
                    node_type = args.get("type")
                    if node_type != "composeVideo":
                        continue
                    cfg = args.get("config")
                    if not isinstance(cfg, dict):
                        continue
                    # Enforce single-run duration constraint: 10–15 seconds.
                    # If the model requested a longer duration, clamp to 15s (and let the UX create additional segments).
                    try:
                        raw_dur = cfg.get("durationSeconds") if cfg.get("durationSeconds") is not None else cfg.get("duration")
                        if isinstance(raw_dur, (int, float)):
                            requested = float(raw_dur)
                            if requested < 10:
                                cfg["durationSeconds"] = 10
                            elif requested > 15:
                                cfg["durationSeconds"] = 15
                                # Add a gentle hint so the user can continue with Part 2, without forcing extra nodes.
                                if isinstance(cfg.get("prompt"), str) and "分段" not in cfg["prompt"]:
                                    cfg["prompt"] = (
                                        cfg["prompt"].rstrip()
                                        + "\n\n约束：本次为第1段（<=15秒）。如需更长成片，请分段生成第2段/第3段。"
                                    )
                            else:
                                cfg["durationSeconds"] = int(round(requested))
                    except Exception:
                        pass
                    prompt_val = cfg.get("prompt")
                    if isinstance(prompt_val, str) and prompt_val.strip():
                        continue
                    if isinstance(cfg.get("shots"), list) or isinstance(cfg.get("characters"), list):
                        coerced = _composevideo_prompt_from_structured_config(cfg)
                        if coerced:
                            cfg["prompt"] = coerced

                # Storyboard workflow: prefer "九宫格分镜图(image) -> composeVideo" (single reference image).
                # Note: users may ask for "短片/宣传片/产品介绍" without mentioning "分镜/九宫格";
                # we infer storyboard intent from tool calls as well to keep continuity and auto-connect references.
                wants_storyboard_by_user = any(
                    kw in (last_user_text or "")
                    for kw in ("分镜", "故事板", "storyboard", "九宫格", "15s")
                )
                has_compose_video = any(
                    c.get("name") == "createNode"
                    and (c.get("arguments") or {}).get("type") == "composeVideo"
                    for c in tool_calls_payload
                )
                storyboard_image_label = None
                storyboard_image_prompt = None
                for c in tool_calls_payload:
                    if c.get("name") != "createNode":
                        continue
                    args = c.get("arguments") or {}
                    if args.get("type") != "image":
                        continue
                    cfg = args.get("config") or {}
                    prompt = cfg.get("prompt") if isinstance(cfg, dict) else None
                    label = args.get("label")
                    if isinstance(label, str) and label.strip():
                        label = label.strip()
                    else:
                        label = None
                    hint = (label or "") + "\n" + (prompt or "")
                    if any(k in hint for k in ("九宫格", "3x3", "分镜", "storyboard")):
                        storyboard_image_label = label
                        storyboard_image_prompt = prompt if isinstance(prompt, str) else None
                        break

                wants_storyboard = wants_storyboard_by_user or bool(storyboard_image_label)

                # If we are creating a storyboard grid image, connect existing character/reference images
                # (already generated on canvas) as upstream inputs BEFORE running the storyboard node.
                def _pick_reference_image_labels_from_canvas_context(
                    canvas_context_obj: dict | None, storyboard_label: str
                ) -> list[str]:
                    if not isinstance(canvas_context_obj, dict):
                        return []
                    nodes_ctx = canvas_context_obj.get("nodes")
                    if not isinstance(nodes_ctx, list) or not nodes_ctx:
                        return []
                    # 1) Prefer the most recent successful storyboard image as continuity anchor (previous episode/segment).
                    storyboard_anchor: str | None = None
                    for n in reversed(nodes_ctx):
                        if not isinstance(n, dict):
                            continue
                        label = n.get("label")
                        if not isinstance(label, str) or not label.strip():
                            continue
                        label = label.strip()
                        if label == storyboard_label:
                            continue
                        kind = n.get("kind") or n.get("type")
                        if kind not in ("image", "textToImage", "mosaic"):
                            continue
                        if n.get("status") != "success":
                            continue
                        image_url = n.get("imageUrl")
                        if not isinstance(image_url, str) or not image_url.strip():
                            continue
                        hint = f"{label}\n{n.get('promptPreview') or ''}"
                        if any(k in hint for k in ("九宫格", "3x3", "分镜", "storyboard")):
                            storyboard_anchor = label
                            break

                    # 2) Fill remaining slots with subject anchors (characters/products/key props),
                    # excluding storyboard/video nodes to avoid over-weighting structure over subject identity.
                    candidates: list[tuple[int, int, str]] = []
                    for idx, n in enumerate(nodes_ctx):
                        if not isinstance(n, dict):
                            continue
                        label = n.get("label")
                        if not isinstance(label, str) or not label.strip():
                            continue
                        label = label.strip()
                        if label == storyboard_label:
                            continue
                        kind = n.get("kind") or n.get("type")
                        if kind not in ("image", "textToImage", "mosaic"):
                            continue
                        if n.get("status") != "success":
                            continue
                        image_url = n.get("imageUrl")
                        if not isinstance(image_url, str) or not image_url.strip():
                            continue
                        if any(k in label for k in ("分镜", "九宫格", "storyboard", "视频", "15s视频")):
                            continue
                        score = 0
                        if any(k in label for k in ("角色", "设定", "立绘", "主视觉", "character", "design")):
                            score += 3
                        # Products / key props hints
                        if any(k in label for k in ("产品", "道具", "物件", "prop", "product")):
                            score += 2
                        if any(k in label.lower() for k in ("fox", "bunny", "rabbit")) or any(
                            k in label for k in ("狐狸", "兔子")
                        ):
                            score += 2
                        candidates.append((score, idx, label))
                    candidates.sort(key=lambda t: (t[0], t[1]), reverse=True)
                    picked: list[str] = []
                    if storyboard_anchor:
                        picked.append(storyboard_anchor)
                    for _, _, label in candidates:
                        if label in picked:
                            continue
                        picked.append(label)
                        if len(picked) >= 3:
                            break
                    return picked[:3]

                if wants_storyboard and isinstance(storyboard_image_label, str) and storyboard_image_label:
                    canvas_context_obj = state.get("canvas_context")
                    reference_labels = _pick_reference_image_labels_from_canvas_context(
                        canvas_context_obj, storyboard_image_label
                    )
                    # Inject a default continuity constraint into the storyboard prompt:
                    # - panel-to-panel bridge frame (end pose/composition repeats at next start)
                    # - if previous storyboard is among references, continue from its final panel
                    try:
                        for c in tool_calls_payload:
                            if c.get("name") != "createNode":
                                continue
                            args = c.get("arguments") or {}
                            if args.get("type") != "image":
                                continue
                            label = args.get("label")
                            if not isinstance(label, str) or label.strip() != storyboard_image_label:
                                continue
                            cfg = args.get("config")
                            if not isinstance(cfg, dict):
                                continue
                            prompt_val = cfg.get("prompt")
                            if not isinstance(prompt_val, str) or not prompt_val.strip():
                                continue
                            if "衔接帧" in prompt_val or "bridge frame" in prompt_val.lower():
                                break
                            continuity = (
                                "\n\n连续性要求（很重要）：\n"
                                "- 九宫格面板之间要有“衔接帧”感觉：面板N的结尾姿态/构图/机位/光线，应与面板N+1的开场保持一致（像同一动作的承接），避免突兀跳切。\n"
                                "- 如果上游参考里包含上一张九宫格分镜图：请让本次面板1自然承接上一张的面板9（构图/主体位置/光线延续），再继续推进新内容。\n"
                                "- 场景不要自由切换；主体数量不要在分镜中途增删。\n"
                            )
                            cfg["prompt"] = prompt_val.rstrip() + continuity
                            break
                    except Exception:
                        pass
                    if reference_labels:
                        existing_pairs: set[tuple[str, str]] = set()
                        try:
                            existing_pairs |= _canvas_existing_pairs_by_label(state.get("canvas_context"))
                        except Exception:
                            pass
                        for c in tool_calls_payload:
                            if c.get("name") != "connectNodes":
                                continue
                            args = c.get("arguments") or {}
                            src = args.get("sourceNodeId") or args.get("sourceId")
                            tgt = args.get("targetNodeId") or args.get("targetId")
                            if isinstance(src, str) and isinstance(tgt, str):
                                s = src.strip()
                                t = tgt.strip()
                                if s and t:
                                    existing_pairs.add((s, t))

                        create_idx = None
                        run_idx = None
                        for i, c in enumerate(tool_calls_payload):
                            if c.get("name") == "createNode":
                                args = c.get("arguments") or {}
                                label = args.get("label")
                                if isinstance(label, str) and label.strip() == storyboard_image_label:
                                    create_idx = i
                                    continue
                            if c.get("name") == "runNode":
                                args = c.get("arguments") or {}
                                node_id = args.get("nodeId")
                                if isinstance(node_id, str) and node_id.strip() == storyboard_image_label:
                                    run_idx = i
                                    break
                        insert_at = run_idx if run_idx is not None else len(tool_calls_payload)
                        if create_idx is not None and insert_at <= create_idx:
                            insert_at = create_idx + 1

                        connect_calls: list[dict] = []
                        for src_label in reference_labels:
                            if (src_label, storyboard_image_label) in existing_pairs:
                                continue
                            connect_calls.append(
                                {
                                    "id": f"auto_ref_{src_label}_to_{storyboard_image_label}",
                                    "name": "connectNodes",
                                    "arguments": {
                                        "sourceNodeId": src_label,
                                        "targetNodeId": storyboard_image_label,
                                        "sourceHandle": "out-image",
                                        "targetHandle": "in-image",
                                    },
                                }
                            )
                        if connect_calls:
                            tool_calls_payload[insert_at:insert_at] = connect_calls

                if wants_storyboard and storyboard_image_label and not has_compose_video:
                    video_label = storyboard_image_label.replace("九宫格分镜", "15s视频").replace("分镜", "15s视频")
                    if video_label == storyboard_image_label:
                        video_label = f"{storyboard_image_label}-15s视频"
                    storyboard_hint = ""
                    if isinstance(storyboard_image_prompt, str) and storyboard_image_prompt.strip():
                        normalized = "\n".join(
                            [ln.strip() for ln in storyboard_image_prompt.strip().splitlines() if ln.strip()]
                        )
                        if len(normalized) > 1200:
                            normalized = normalized[:1200].rstrip() + "…"
                        storyboard_hint = (
                            "\n\n分镜补充（来自九宫格分镜的镜头描述，用于动作/镜头节奏对齐；以参考图为准）：\n"
                            + normalized
                        )
                    video_prompt = (
                        "根据上游参考图片（九宫格分镜图）生成一个15秒的二维动画视频：\n"
                        "- 画面风格/角色外观严格跟随参考图；不要改变角色造型与配色。\n"
                        "- 按参考图的镜头节奏推进（从1到9），镜头之间自然衔接；保持同一场景光线连续。\n"
                        "- 不要出现任何可读文字/水印/Logo。\n"
                        "- 输出16:9，动作清晰，镜头稳定，节奏温暖治愈。"
                        + storyboard_hint
                    )
                    tool_calls_payload.append(
                        {
                            "id": f"auto_create_video_{video_label}",
                            "name": "createNode",
                            "arguments": {
                                "type": "composeVideo",
                                "label": video_label,
                                "config": {
                                    "kind": "composeVideo",
                                    "durationSeconds": 15,
                                    "aspectRatio": "16:9",
                                    "prompt": video_prompt,
                                },
                            },
                        }
                    )
                    tool_calls_payload.append(
                        {
                            "id": f"auto_connect_{storyboard_image_label}_to_{video_label}",
                            "name": "connectNodes",
                            "arguments": {
                                "sourceNodeId": storyboard_image_label,
                                "targetNodeId": video_label,
                                "sourceHandle": "out-image",
                                "targetHandle": "in-image",
                            },
                        }
                    )

                # General continuity: if the user asks to base new content on existing results (基于/续写/同款/延展),
                # ensure newly created image nodes are connected to a relevant upstream image before running.
                reference_intent = any(
                    kw in (last_user_text or "")
                    for kw in ("基于", "同款", "同风格", "沿用", "续写", "延展", "变体", "参考", "保持一致")
                )

                def _pick_latest_success_image_label(canvas_context_obj: dict | None) -> str | None:
                    if not isinstance(canvas_context_obj, dict):
                        return None
                    nodes_ctx = canvas_context_obj.get("nodes")
                    if not isinstance(nodes_ctx, list) or not nodes_ctx:
                        return None
                    # iterate from latest to oldest
                    for n in reversed(nodes_ctx):
                        if not isinstance(n, dict):
                            continue
                        kind = n.get("kind") or n.get("type")
                        if kind not in ("image", "textToImage", "mosaic"):
                            continue
                        if n.get("status") != "success":
                            continue
                        label = n.get("label")
                        if not isinstance(label, str) or not label.strip():
                            continue
                        label = label.strip()
                        if any(k in label for k in ("分镜", "九宫格", "storyboard")):
                            continue
                        image_url = n.get("imageUrl")
                        if not isinstance(image_url, str) or not image_url.strip():
                            continue
                        return label
                    return None

                if reference_intent:
                    canvas_context_obj = state.get("canvas_context")
                    upstream_label = _pick_latest_success_image_label(canvas_context_obj)
                    if upstream_label:
                        # Build a set of (source,target) already connected in this payload to avoid duplicates.
                        existing_pairs: set[tuple[str, str]] = set()
                        existing_targets: set[str] = set()
                        try:
                            existing_pairs |= _canvas_existing_pairs_by_label(state.get("canvas_context"))
                            for _, t in existing_pairs:
                                existing_targets.add(t)
                        except Exception:
                            pass
                        for c in tool_calls_payload:
                            if c.get("name") != "connectNodes":
                                continue
                            args = c.get("arguments") or {}
                            src = args.get("sourceNodeId") or args.get("sourceId")
                            tgt = args.get("targetNodeId") or args.get("targetId")
                            if isinstance(src, str) and isinstance(tgt, str):
                                s = src.strip()
                                t = tgt.strip()
                                if s and t:
                                    existing_pairs.add((s, t))
                                    existing_targets.add(t)

                        # For each newly created image node, if it has no inbound connection yet, add one.
                        for idx, c in enumerate(list(tool_calls_payload)):
                            if c.get("name") != "createNode":
                                continue
                            args = c.get("arguments") or {}
                            if args.get("type") != "image":
                                continue
                            label = args.get("label")
                            if not isinstance(label, str) or not label.strip():
                                continue
                            target_label = label.strip()
                            if target_label == upstream_label:
                                continue
                            # Skip storyboard grid; it has its own multi-reference logic above.
                            cfg = args.get("config") or {}
                            prompt = cfg.get("prompt") if isinstance(cfg, dict) else ""
                            hint = f"{target_label}\n{prompt}"
                            if any(k in hint for k in ("九宫格", "3x3", "分镜", "storyboard")):
                                continue
                            if target_label in existing_targets:
                                continue
                            if (upstream_label, target_label) in existing_pairs:
                                continue

                            # Insert before the runNode(target) if present, otherwise right after createNode.
                            insert_at = idx + 1
                            for j in range(idx + 1, len(tool_calls_payload)):
                                tc = tool_calls_payload[j]
                                if tc.get("name") != "runNode":
                                    continue
                                nid = (tc.get("arguments") or {}).get("nodeId")
                                if isinstance(nid, str) and nid.strip() == target_label:
                                    insert_at = j
                                    break
                            tool_calls_payload.insert(
                                insert_at,
                                {
                                    "id": f"auto_ref_{upstream_label}_to_{target_label}",
                                    "name": "connectNodes",
                                    "arguments": {
                                        "sourceNodeId": upstream_label,
                                        "targetNodeId": target_label,
                                        "sourceHandle": "out-image",
                                        "targetHandle": "in-image",
                                    },
                                },
                            )
                            existing_targets.add(target_label)

                # If this response sets up an image->video storyboard workflow, avoid prematurely running video.
                created_image_labels: set[str] = set()
                created_video_labels: set[str] = set()
                for call in tool_calls_payload:
                    if call.get("name") != "createNode":
                        continue
                    args = call.get("arguments") or {}
                    node_type = args.get("type")
                    label = args.get("label")
                    if not isinstance(label, str) or not label.strip():
                        continue
                    if node_type in ("image", "textToImage"):
                        created_image_labels.add(label.strip())
                    if node_type == "composeVideo":
                        created_video_labels.add(label.strip())

                if created_image_labels and created_video_labels:
                    tool_calls_payload[:] = [
                        c
                        for c in tool_calls_payload
                        if not (
                            c.get("name") == "runNode"
                            and isinstance((c.get("arguments") or {}).get("nodeId"), str)
                            and (c.get("arguments") or {}).get("nodeId").strip() in created_video_labels
                        )
                    ]

                created_labels: list[str] = []
                already_running: set[str] = set()
                for call in tool_calls_payload:
                    if call.get("name") == "runNode":
                        args = call.get("arguments") or {}
                        node_id = args.get("nodeId")
                        if isinstance(node_id, str) and node_id.strip():
                            already_running.add(node_id.strip())
                    if call.get("name") == "createNode":
                        args = call.get("arguments") or {}
                        node_type = args.get("type")
                        label = args.get("label")
                        if (
                            node_type in ("image", "textToImage")
                            and isinstance(label, str)
                            and label.strip()
                        ):
                            created_labels.append(label.strip())
                for label in created_labels:
                    if label in already_running:
                        continue
                    tool_calls_payload.append(
                        {
                            "id": f"auto_run_{label}",
                            "name": "runNode",
                            "arguments": {"nodeId": label},
                        }
                    )
            result = AIMessage(content=result_text)
        except ValueError as exc:
            debug_openai_error("finalize_answer", exc)
            llm_error_payload = {"type": exc.__class__.__name__, "message": str(exc)}
            result = AIMessage(
                content="无法生成最终答案：后端未配置模型密钥（请检查 OPENAI_API_KEY / GEMINI_API_KEY）。"
            )
        except (APIConnectionError, OpenAIError) as exc:
            debug_openai_error("finalize_answer", exc)
            llm_error_payload = _format_openai_error(exc)
            result = AIMessage(
                content=f"无法生成最终答案：OpenAI 接口异常（{_summarize_openai_error(llm_error_payload)}）。"
            )
        except Exception as exc:  # pragma: no cover
            debug_openai_error("finalize_answer", exc)
            llm_error_payload = {"type": exc.__class__.__name__, "message": str(exc)}
            result = AIMessage(content="无法生成最终答案：运行时异常。")
    else:
        # init Reasoning Model, default to Gemini 2.5 Flash
        llm = ChatGoogleGenerativeAI(
            model=reasoning_model,
            temperature=0,
            max_retries=2,
            api_key=get_gemini_api_key(),
        )
        result = llm.invoke(formatted_prompt)

    # Replace the short urls with the original urls and add all used urls to the sources_gathered
    unique_sources = []
    content = result.content
    if (not isinstance(content, str) or not content.strip()) and tool_calls_payload:
        content = _fallback_text_from_tool_calls(tool_calls_payload)
    if isinstance(content, str) and content.strip():
        content, quick_replies_payload = _extract_tapcanvas_actions(content)

    # Ensure the assistant always provides a "hook" to continue after any canvas operations.
    # If the model didn't provide quick replies, synthesize a few safe next-step options.
    if tool_calls_payload:
        try:
            created_images: list[str] = []
            created_videos: list[str] = []
            ran_nodes: set[str] = set()
            for call in tool_calls_payload:
                name = call.get("name")
                args = call.get("arguments") or {}
                if name == "createNode":
                    label = args.get("label")
                    node_type = args.get("type")
                    if isinstance(label, str) and label.strip():
                        label = label.strip()
                        if node_type in ("image", "textToImage"):
                            created_images.append(label)
                        if node_type == "composeVideo":
                            created_videos.append(label)
                if name == "runNode":
                    node_id = args.get("nodeId")
                    if isinstance(node_id, str) and node_id.strip():
                        ran_nodes.add(node_id.strip())

            if not quick_replies_payload:
                actions: list[dict] = []
                # If we created a video node but didn't run it (common storyboard flow), offer to run it next.
                for v in created_videos:
                    if v in ran_nodes:
                        continue
                    actions.append(
                        {
                            "label": "继续生成15s视频",
                            "input": f"请运行节点：{v}。",
                        }
                    )
                    break
                # Offer to iterate on the just-created image/storyboard.
                if created_images:
                    img = created_images[-1]
                    actions.append(
                        {
                            "label": "微调九宫格分镜",
                            "input": f"请基于刚生成的九宫格分镜图（{img}）做微调：镜头更紧凑、关键转折更清晰、字幕更短更有黑色幽默；然后再生成15s视频。",
                        }
                    )
                actions.append(
                    {
                        "label": "换一个方向/风格",
                        "input": "我想换一个方向/风格：\n- 新风格：\n- 重点改动：\n请基于当前项目重新生成九宫格分镜并继续生成15s视频。",
                    }
                )
                quick_replies_payload = actions[:4]

            # Append a minimal next-step hook to the message text (avoid repeating if already present).
            if isinstance(content, str):
                if "下一步" not in content and "你下一步" not in content and "点一个" not in content:
                    content = (content.strip() + "\n\n分镜生成后，点下面选项继续。").strip()
        except Exception:
            # best-effort only
            pass
    for source in state["sources_gathered"]:
        if source["short_url"] in content:
            content = content.replace(source["short_url"], source["value"])
            unique_sources.append(source)

    # Normalize content/tool calls
    tool_calls_payload = locals().get("tool_calls_payload", []) or []

    message_kwargs = {
        "active_role": resolved_id,
        "active_role_name": profile["name"],
        "active_role_reason": state.get("active_role_reason", "根据对话意图选择。"),
        "active_intent": state.get("active_intent", ""),
        "active_tool_tier": state.get("active_tool_tier", "none"),
        "allow_canvas_tools": bool(state.get("allow_canvas_tools", False)),
        "allow_canvas_tools_reason": state.get("allow_canvas_tools_reason", ""),
    }
    if tool_calls_payload:
        message_kwargs["tool_calls"] = tool_calls_payload
    if quick_replies_payload:
        message_kwargs["quick_replies"] = quick_replies_payload
    if llm_error_payload:
        message_kwargs["llm_error"] = llm_error_payload

    return {
        "messages": [
            AIMessage(
                content=content,
                additional_kwargs=message_kwargs,
            )
        ],
        "sources_gathered": unique_sources,
        "active_role": resolved_id,
        "active_role_name": profile["name"],
        "active_role_reason": state.get("active_role_reason", "根据对话意图选择。"),
        "active_intent": state.get("active_intent", ""),
        "active_tool_tier": state.get("active_tool_tier", "none"),
        "agent_loop_count": agent_loop_count,
    }


# Create our Agent Graph
builder = StateGraph(OverallState, config_schema=Configuration)

# Define the nodes we will cycle between (web_research removed for animation/video focus)
builder.add_node("select_role", select_role)


def direct_answer(state: OverallState, config: RunnableConfig):
    """Direct answer node without web search."""
    # ensure defaults to avoid missing keys
    state.setdefault("web_research_result", [])
    state.setdefault("sources_gathered", [])
    return finalize_answer(state, config)

def kb_retrieve(state: OverallState, config: RunnableConfig) -> OverallState:
    """Optional knowledge-base retrieval (e.g. Cloudflare AutoRAG) to ground the answer."""
    configurable = Configuration.from_runnable_config(config)
    # This project uses RAG on-demand only (never external web search).
    requested_tier = (state.get("active_tool_tier") or "").strip().lower()
    if requested_tier != "rag":
        return {}

    # Use the latest user message as the query (avoid echoing full thread history).
    query = ""
    try:
        for m in reversed(state.get("messages") or []):
            if getattr(m, "type", None) == "human" or getattr(m, "role", None) == "user":
                query = str(getattr(m, "content", "") or "").strip()
                break
    except Exception:
        query = ""
    if not query:
        return {}

    # Allow RAG retrieval even when search_provider is "disabled", as long as AutoRAG is configured.
    provider = (configurable.search_provider or "").strip().lower()
    if provider not in ("", "disabled", "autorag"):
        return {}

    snippets, sources = _call_autorag_search(configurable, query)
    if not snippets:
        return {}
    return {
        "search_query": [query],
        "web_research_result": snippets,
        "sources_gathered": sources or [],
    }

builder.add_node("direct_answer", direct_answer)
builder.add_node("kb_retrieve", kb_retrieve)


def summarize_memory(state: OverallState, config: RunnableConfig) -> OverallState:
    """Best-effort conversation summarization to keep long threads compact.

    This runs after answering. The summary is returned in `conversation_summary` and can be
    persisted by the frontend (e.g. in D1) to survive thread expiry/restarts.
    """
    try:
        messages = state.get("messages") or []
        if not isinstance(messages, list):
            return {}
        # Do not summarize short threads.
        tail_keep = 16
        if len(messages) <= tail_keep:
            return {}
        rendered = format_messages_for_prompt(messages)
        # Trigger only when the serialized history becomes large.
        trigger_chars = 120_000
        if isinstance(rendered, str) and len(rendered) < trigger_chars:
            # Still allow a first-time summary when the conversation is moderately long.
            if not (isinstance(state.get("conversation_summary"), str) and state.get("conversation_summary").strip()):
                if len(messages) < 40:
                    return {}
            else:
                return {}

        configurable = Configuration.from_runnable_config(config)
        llm_provider = resolve_llm_provider(configurable.llm_provider)
        model = getattr(configurable, "reflection_model", None) or configurable.answer_model
        prev = state.get("conversation_summary") or ""
        older = format_messages_for_prompt(messages[:-tail_keep])
        recent = format_messages_for_prompt(messages[-tail_keep:])
        canvas_context = state.get("canvas_context")
        canvas_context_text = _render_canvas_context_for_prompt(canvas_context)
        prompt = (
            "You are a background memory compressor for a creative assistant.\n"
            "Goal: produce a compact, durable conversation summary that preserves user intent, preferences, constraints,\n"
            "project/canvas facts, and any decisions. This summary will be injected into future prompts.\n"
            "Rules:\n"
            "- Output plain text only (no markdown fences).\n"
            "- Max 1800 characters.\n"
            "- Prefer stable facts over transient chatter.\n"
            "- Keep named entities, style locks, and any explicit constraints.\n"
            "- If there is a previous summary, update it incrementally; do not rewrite from scratch unless necessary.\n\n"
            f"CANVAS_CONTEXT:\n{canvas_context_text}\n\n"
            f"PREVIOUS_SUMMARY:\n{str(prev).strip()}\n\n"
            f"OLDER_MESSAGES_TO_COMPRESS:\n{older}\n\n"
            f"RECENT_TURNS (do not fully duplicate; keep as-is for recency):\n{recent}\n"
        )

        new_summary = ""
        if llm_provider == "openai":
            client = get_openai_client()
            try:
                response = client.responses.create(
                    model=model,
                    input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
                    stream=True,
                )
                debug_openai_response("summarize_memory", response)
                new_summary = _collect_stream_text(response)
            except Exception as exc:
                debug_openai_error("summarize_memory responses_fallback", exc)
                chat = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0,
                )
                msg = chat.choices[0].message
                new_summary = str(getattr(msg, "content", "") or "")
        else:
            llm = ChatGoogleGenerativeAI(
                model=model,
                temperature=0,
                max_retries=2,
                api_key=get_gemini_api_key(),
            )
            new_summary = str(llm.invoke(prompt).content or "")

        if not isinstance(new_summary, str):
            return {}
        new_summary = new_summary.strip()
        if not new_summary:
            return {}
        # Clamp overly-long outputs defensively.
        if len(new_summary) > 2200:
            new_summary = new_summary[:2200].rstrip()
        return {"conversation_summary": new_summary}
    except Exception:
        return {}


builder.add_node("summarize_memory", summarize_memory)

# Entrypoint: role selection then direct answer (no web search)
builder.add_edge(START, "select_role")
builder.add_edge("select_role", "kb_retrieve")
builder.add_edge("kb_retrieve", "direct_answer")
builder.add_edge("direct_answer", "summarize_memory")
builder.add_edge("summarize_memory", END)

graph = builder.compile(name="animation-agent")
