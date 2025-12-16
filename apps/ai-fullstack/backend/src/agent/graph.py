import os
import json
import urllib.request
import urllib.error

from agent.tools_and_schemas import RoleDecision, SearchQueryList, Reflection
from dotenv import load_dotenv
from openai import OpenAI, APIConnectionError, OpenAIError
from langchain_core.messages import AIMessage
from langgraph.types import Send
from langgraph.graph import StateGraph
from langgraph.graph import START, END
from langchain_core.runnables import RunnableConfig
from google.genai import Client

from agent.state import (
    OverallState,
    QueryGenerationState,
    ReflectionState,
    WebSearchState,
)
from agent.configuration import Configuration
from agent.prompts import (
    role_router_instructions,
    get_current_date,
    query_writer_instructions,
    web_searcher_instructions,
    reflection_instructions,
    answer_instructions,
)
from langchain_google_genai import ChatGoogleGenerativeAI
from agent.utils import (
    format_messages_for_prompt,
    get_citations,
    get_research_topic,
    insert_citation_markers,
    resolve_urls,
)
from agent.roles import DEFAULT_ROLE_ID, normalize_role_id, role_map, roles_prompt_block

load_dotenv()

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
    """Ensure GEMINI_API_KEY is available before using Gemini models."""
    if os.getenv("GEMINI_API_KEY") is None:
        raise ValueError("GEMINI_API_KEY is not set; required for Gemini-based steps.")


def get_genai_client() -> Client:
    """Create a Gemini client when needed to avoid import-time failures."""
    require_gemini_key()
    return Client(api_key=os.getenv("GEMINI_API_KEY"))


def get_openai_client() -> OpenAI:
    """Return an OpenAI client configured with optional custom base URL."""
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key is None:
        raise ValueError("OPENAI_API_KEY is not set; required for OpenAI-based steps.")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
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
    parts.append("15秒分镜视频提示词（分镜清单 + 镜头语言）")
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
        debug_openai_error(f"{schema_model.__name__}", exc)
        try:
            if client is None:
                raise first_exc or ValueError("OpenAI client is unavailable.")
            response = client.responses.create(
                model=model,
                input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
                stream=True,
            )
            debug_openai_response(f"{schema_model.__name__}", response)
            text = _collect_stream_text(response)
        except Exception as exc2:
            debug_openai_error(f"{schema_model.__name__} fallback", exc2)
            text = ""
    try:
        return schema_model.model_validate_json(text)
    except Exception as exc:
        # Fallback: if provider ignores JSON format, try to construct minimal valid payload
        if schema_model.__name__ == "SearchQueryList":
            rationale = "Fallback from unparseable model output."
            if first_exc is not None and not text:
                rationale = f"Fallback due to OpenAI error: {_format_openai_error(first_exc).get('message', '')}"
            return schema_model(query=[prompt], rationale=rationale)
        if schema_model.__name__ == "Reflection":
            # This node is unused in the current (no web research) graph, but keep a safe default.
            return schema_model(
                is_sufficient=True, knowledge_gap="", follow_up_queries=[]
            )
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


def _resolve_role(role_id: str):
    """Return a validated role id and its profile."""
    resolved_id = normalize_role_id(role_id)
    mapping = role_map()
    profile = mapping.get(resolved_id, mapping[DEFAULT_ROLE_ID])
    return resolved_id, profile


# Nodes
def select_role(state: OverallState, config: RunnableConfig) -> OverallState:
    """Pick the active assistant role based on the latest conversation."""
    configurable = Configuration.from_runnable_config(config)
    llm_provider = configurable.llm_provider.lower()
    conversation = format_messages_for_prompt(state["messages"])
    canvas_context = state.get("canvas_context")
    canvas_context_text = ""
    if canvas_context:
        try:
            canvas_context_text = json.dumps(canvas_context, ensure_ascii=False)
        except Exception:
            canvas_context_text = str(canvas_context)
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
            api_key=os.getenv("GEMINI_API_KEY"),
        )
        result = llm.with_structured_output(RoleDecision).invoke(prompt)

    resolved_id, profile = _resolve_role(result.role_id)
    reason = result.reason or "基于对话意图的默认选择。"

    # ensure defaults for downstream (even though web research removed)
    defaults = {
        "search_query": [],
        "web_research_result": [],
        "sources_gathered": [],
        "initial_search_query_count": state.get("initial_search_query_count", 0),
        "max_research_loops": state.get("max_research_loops", 0),
    }

    return {
        "active_role": resolved_id,
        "active_role_name": profile["name"],
        "active_role_reason": reason,
        **{k: v for k, v in defaults.items() if k not in state},
    }


# Nodes
def generate_query(state: OverallState, config: RunnableConfig) -> QueryGenerationState:
    """LangGraph node that generates search queries based on the User's question.

    Uses Gemini 2.0 Flash to create an optimized search queries for web research based on
    the User's question.

    Args:
        state: Current graph state containing the User's question
        config: Configuration for the runnable, including LLM provider settings

    Returns:
        Dictionary with state update, including search_query key containing the generated queries
    """
    configurable = Configuration.from_runnable_config(config)
    llm_provider = configurable.llm_provider.lower()

    # check for custom initial search query count
    if state.get("initial_search_query_count") is None:
        state["initial_search_query_count"] = configurable.number_of_initial_queries

    # OpenAI path (Responses API)
    if llm_provider == "openai":
        current_date = get_current_date()
        formatted_prompt = query_writer_instructions.format(
            current_date=current_date,
            research_topic=get_research_topic(state["messages"]),
            number_queries=state["initial_search_query_count"],
        )
        result = _call_openai_structured(
            configurable.query_generator_model, formatted_prompt, SearchQueryList
        )
        return {"search_query": result.query}

    # init Gemini 2.0 Flash
    require_gemini_key()
    llm = ChatGoogleGenerativeAI(
        model=configurable.query_generator_model,
        temperature=1.0,
        max_retries=2,
        api_key=os.getenv("GEMINI_API_KEY"),
    )
    structured_llm = llm.with_structured_output(SearchQueryList)

    # Format the prompt
    current_date = get_current_date()
    formatted_prompt = query_writer_instructions.format(
        current_date=current_date,
        research_topic=get_research_topic(state["messages"]),
        number_queries=state["initial_search_query_count"],
    )
    # Generate the search queries
    result = structured_llm.invoke(formatted_prompt)
    return {"search_query": result.query}


def continue_to_web_research(state: QueryGenerationState):
    """LangGraph node that sends the search queries to the web research node.

    This is used to spawn n number of web research nodes, one for each search query.
    """
    return [
        Send("web_research", {"search_query": search_query, "id": int(idx)})
        for idx, search_query in enumerate(state["search_query"])
    ]


def web_research(state: WebSearchState, config: RunnableConfig) -> OverallState:
    """LangGraph node that performs web research using the native Google Search API tool.

    Executes a web search using the native Google Search API tool in combination with Gemini 2.0 Flash.

    Args:
        state: Current graph state containing the search query and research loop count
        config: Configuration for the runnable, including search API settings

    Returns:
        Dictionary with state update, including sources_gathered, research_loop_count, and web_research_results
    """
    # Configure
    configurable = Configuration.from_runnable_config(config)
    provider = configurable.search_provider.lower()
    formatted_prompt = web_searcher_instructions.format(
        current_date=get_current_date(),
        research_topic=state["search_query"],
    )

    if provider == "disabled":
        return {
            "sources_gathered": [],
            "search_query": [state["search_query"]],
            "web_research_result": ["[mocked search result: no external search performed]"],
        }

    if provider == "openai":
        openai_client = get_openai_client()
        try:
            completion = openai_client.responses.create(
                model=configurable.search_model,
                input=[
                    {
                        "role": "user",
                        "content": [{"type": "input_text", "text": formatted_prompt}],
                    }
                ],
                tools=[{"type": "web_search"}],
                stream=True,
            )
            debug_openai_response("web_research", completion)
            output_text = _collect_stream_text(completion)
        except (APIConnectionError, OpenAIError, Exception):
            output_text = "搜索失败：OpenAI API 未返回结果（连接或接口异常）。"
        return {
            "sources_gathered": [],
            "search_query": [state["search_query"]],
            "web_research_result": [output_text],
        }

    # Default to Gemini search
    # Uses the google genai client as the langchain client doesn't return grounding metadata
    genai_client = get_genai_client()
    response = genai_client.models.generate_content(
        model=configurable.search_model,
        contents=formatted_prompt,
        config={
            "tools": [{"google_search": {}}],
            "temperature": 0,
        },
    )
    # resolve the urls to short urls for saving tokens and time
    resolved_urls = resolve_urls(
        response.candidates[0].grounding_metadata.grounding_chunks, state["id"]
    )
    # Gets the citations and adds them to the generated text
    citations = get_citations(response, resolved_urls)
    modified_text = insert_citation_markers(response.text, citations)
    sources_gathered = [item for citation in citations for item in citation["segments"]]

    return {
        "sources_gathered": sources_gathered,
        "search_query": [state["search_query"]],
        "web_research_result": [modified_text],
    }


def reflection(state: OverallState, config: RunnableConfig) -> ReflectionState:
    """LangGraph node that identifies knowledge gaps and generates potential follow-up queries.

    Analyzes the current summary to identify areas for further research and generates
    potential follow-up queries. Uses structured output to extract
    the follow-up query in JSON format.

    Args:
        state: Current graph state containing the running summary and research topic
        config: Configuration for the runnable, including LLM provider settings

    Returns:
        Dictionary with state update, including search_query key containing the generated follow-up query
    """
    configurable = Configuration.from_runnable_config(config)
    llm_provider = configurable.llm_provider.lower()
    # Increment the research loop count and get the reasoning model
    state["research_loop_count"] = state.get("research_loop_count", 0) + 1
    reasoning_model = state.get("reasoning_model", configurable.reflection_model)

    # Format the prompt
    current_date = get_current_date()
    formatted_prompt = reflection_instructions.format(
        current_date=current_date,
        research_topic=get_research_topic(state["messages"]),
        summaries="\n\n---\n\n".join(state["web_research_result"]),
    )
    # OpenAI path (Responses API)
    if llm_provider == "openai":
        result = _call_openai_structured(
            reasoning_model,
            formatted_prompt,
            Reflection,
        )
        return {
            "is_sufficient": result.is_sufficient,
            "knowledge_gap": result.knowledge_gap,
            "follow_up_queries": result.follow_up_queries,
            "research_loop_count": state["research_loop_count"],
            "number_of_ran_queries": len(state["search_query"]),
        }

    # init Reasoning Model
    require_gemini_key()
    llm = ChatGoogleGenerativeAI(
        model=reasoning_model,
        temperature=1.0,
        max_retries=2,
        api_key=os.getenv("GEMINI_API_KEY"),
    )
    result = llm.with_structured_output(Reflection).invoke(formatted_prompt)

    return {
        "is_sufficient": result.is_sufficient,
        "knowledge_gap": result.knowledge_gap,
        "follow_up_queries": result.follow_up_queries,
        "research_loop_count": state["research_loop_count"],
        "number_of_ran_queries": len(state["search_query"]),
    }


def evaluate_research(
    state: ReflectionState,
    config: RunnableConfig,
) -> OverallState:
    """LangGraph routing function that determines the next step in the research flow.

    Controls the research loop by deciding whether to continue gathering information
    or to finalize the summary based on the configured maximum number of research loops.

    Args:
        state: Current graph state containing the research loop count
        config: Configuration for the runnable, including max_research_loops setting

    Returns:
        String literal indicating the next node to visit ("web_research" or "finalize_summary")
    """
    configurable = Configuration.from_runnable_config(config)
    max_research_loops = (
        state.get("max_research_loops")
        if state.get("max_research_loops") is not None
        else configurable.max_research_loops
    )
    if state["is_sufficient"] or state["research_loop_count"] >= max_research_loops:
        return "finalize_answer"
    else:
        return [
            Send(
                "web_research",
                {
                    "search_query": follow_up_query,
                    "id": state["number_of_ran_queries"] + int(idx),
                },
            )
            for idx, follow_up_query in enumerate(state["follow_up_queries"])
        ]


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
    llm_provider = configurable.llm_provider.lower()
    reasoning_model = state.get("reasoning_model") or configurable.answer_model

    # Resolve role directive for persona-aware answer
    resolved_id, profile = _resolve_role(state.get("active_role", DEFAULT_ROLE_ID))
    role_directive = (
        f"{profile['name']}（{resolved_id}）: {profile['summary']}。回复风格：{profile['style']}。"
        f" 选择原因：{state.get('active_role_reason', '根据对话意图选择。')}"
    )

    # Format the prompt
    current_date = get_current_date()
    canvas_context = state.get("canvas_context")
    canvas_context_text = ""
    if canvas_context:
        try:
            canvas_context_text = json.dumps(canvas_context, ensure_ascii=False)
        except Exception:
            canvas_context_text = str(canvas_context)
    formatted_prompt = answer_instructions.format(
        current_date=current_date,
        research_topic=get_research_topic(state["messages"]),
        role_directive=role_directive,
        summaries="\n---\n\n".join(state["web_research_result"]),
        canvas_context=canvas_context_text,
    )
    tool_calls_payload: list[dict] = []
    llm_error_payload: dict | None = None
    quick_replies_payload: list[dict] | None = None

    def _extract_tapcanvas_actions(text: str) -> tuple[str, list[dict] | None]:
        if not isinstance(text, str) or "```" not in text:
            return text, None
        marker = "```tapcanvas_actions"
        start = text.find(marker)
        if start < 0:
            return text, None
        start_payload = text.find("\n", start + len(marker))
        if start_payload < 0:
            return text, None
        start_payload = start_payload + 1
        end_fence = text.find("```", start_payload)
        if end_fence < 0:
            return text, None
        payload_raw = text[start_payload:end_fence].strip()
        cleaned = (text[:start] + text[end_fence + 3 :]).strip()
        try:
            obj = json.loads(payload_raw)
        except Exception:
            return cleaned, None
        actions = obj.get("actions") if isinstance(obj, dict) else None
        if not isinstance(actions, list):
            return cleaned, None
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
        return cleaned, normalized or None

    if llm_provider == "openai":
        try:
            completion = get_openai_client().responses.create(
                model=reasoning_model,
                input=[
                    {
                        "role": "user",
                        "content": [{"type": "input_text", "text": formatted_prompt}],
                    }
                ],
                tools=_tool_definitions_for_canvas(),
                tool_choice="auto",
                stream=True,
            )
            debug_openai_response("finalize_answer", completion)
            result_text, tool_calls_payload = _collect_stream_text_and_tools(completion)

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
            is_story_suggestion_request = (
                any(k in (last_user_text or "") for k in ("续写", "后续剧情", "接下来", "续作"))
                and any(k in (last_user_text or "") for k in ("推荐", "方向", "灵感", "怎么写"))
                and not any(k in (last_user_text or "") for k in ("九宫格", "分镜", "故事板", "storyboard", "15s"))
            )
            if is_story_suggestion_request and "tapcanvas_actions" not in (result_text or ""):
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
                    prompt_val = cfg.get("prompt")
                    if isinstance(prompt_val, str) and prompt_val.strip():
                        continue
                    if isinstance(cfg.get("shots"), list) or isinstance(cfg.get("characters"), list):
                        coerced = _composevideo_prompt_from_structured_config(cfg)
                        if coerced:
                            cfg["prompt"] = coerced

                # Storyboard workflow: prefer "九宫格分镜图(image) -> composeVideo" (single reference image).
                wants_storyboard = any(
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
                if wants_storyboard:
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
                        if any(k in label.lower() for k in ("fox", "bunny", "rabbit")) or any(
                            k in label for k in ("狐狸", "兔子")
                        ):
                            score += 2
                        candidates.append((score, idx, label))
                    candidates.sort(key=lambda t: (t[0], t[1]), reverse=True)
                    picked = [label for _, _, label in candidates[:3]]
                    return picked

                if wants_storyboard and isinstance(storyboard_image_label, str) and storyboard_image_label:
                    canvas_context_obj = state.get("canvas_context")
                    reference_labels = _pick_reference_image_labels_from_canvas_context(
                        canvas_context_obj, storyboard_image_label
                    )
                    if reference_labels:
                        existing_pairs: set[tuple[str, str]] = set()
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
        require_gemini_key()
        llm = ChatGoogleGenerativeAI(
            model=reasoning_model,
            temperature=0,
            max_retries=2,
            api_key=os.getenv("GEMINI_API_KEY"),
        )
        result = llm.invoke(formatted_prompt)

    # Replace the short urls with the original urls and add all used urls to the sources_gathered
    unique_sources = []
    content = result.content
    if (not isinstance(content, str) or not content.strip()) and tool_calls_payload:
        content = _fallback_text_from_tool_calls(tool_calls_payload)
    if isinstance(content, str) and content.strip():
        content, quick_replies_payload = _extract_tapcanvas_actions(content)
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
    provider = configurable.search_provider.lower()
    if provider != "autorag":
        return {}

    # Use the latest user message as the query.
    query = get_research_topic(state.get("messages") or [])
    if not isinstance(query, str):
        query = ""
    query = query.strip()
    if not query:
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

# Entrypoint: role selection then direct answer (no web search)
builder.add_edge(START, "select_role")
builder.add_edge("select_role", "kb_retrieve")
builder.add_edge("kb_retrieve", "direct_answer")
builder.add_edge("direct_answer", END)

graph = builder.compile(name="animation-agent")
