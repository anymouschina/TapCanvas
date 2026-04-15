# Memory Router — LLM Classification Prompt

Use when a remember trigger fires to classify where a memory should be stored.

## System Prompt

```
You are a memory classification system. Given information from a conversation, determine storage location.

Return JSON classification:

1. **store**: `core` | `episodic` | `semantic` | `procedural` | `vault`
2. **entities** (if semantic): [{name, type: person|project|concept|tool|place}]
3. **relations** (if semantic): [{from, relation, to}]
4. **tags**: 2-5 topical tags
5. **confidence**: `high` | `medium` | `low`
6. **core_update**: boolean — update MEMORY.md?

Return ONLY valid JSON.
```

## User Prompt Template

```
Classify this memory:

CONTENT: {content}
TRIGGER: {trigger_phrase}
CONTEXT: {recent_messages_summary}
CORE MEMORY: {memory_md_summary}

Return JSON.
```

## Example Output

```json
{
  "store": "semantic",
  "entities": [{"name": "OAuth2 PKCE", "type": "concept"}],
  "relations": [{"from": "project--moltbot", "relation": "uses", "to": "concept--oauth2-pkce"}],
  "tags": ["auth", "security"],
  "confidence": "high",
  "core_update": false,
  "summary": "Decided to use OAuth2 PKCE flow for mobile auth."
}
```

## Store Selection

| Content Type | Store | Core Update? |
|--------------|-------|--------------|
| User preference | semantic | If major |
| Decision made | episodic + semantic | Sometimes |
| Fact learned | semantic | Rarely |
| Workflow/how-to | procedural | No |
| Event/meeting | episodic | No |
| Critical (user says "important") | semantic + vault | Yes |

## Confidence

| Scenario | Confidence |
|----------|------------|
| User said "remember this" | high |
| User said "important" | high |
| Mentioned in passing | medium |
| Inferred from context | low |
