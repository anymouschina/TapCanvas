# Moltbot Memory Architecture — Design Document

> *"Memory is where the spirit rests."*
> Version: 0.1-draft | Date: 2026-02-02

---

## 1. Philosophy

Human memory is not a filing cabinet. It's a living system that encodes, consolidates, decays, and reconstructs. This architecture mirrors those properties:

- **Encoding** happens during conversation, triggered by natural language ("remember this", "don't forget")
- **Consolidation** happens during idle time, like the brain during sleep — extracting patterns, pruning noise, strengthening connections
- **Decay** is a feature, not a bug — unaccessed memories fade gracefully, keeping retrieval sharp
- **Reconstruction** means memory isn't playback; it's active interpretation through the agent's current understanding
- **Accountability** means every change is tracked — who made it, why, and when. The agent's cognitive evolution is auditable, revertable, and transparent.

The system is built on four cognitive stores, a keyword-triggered interface, LLM-powered routing, graph-structured semantics, and a sleep-time reflection cycle with human-in-the-loop approval.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   CONTEXT WINDOW                     │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │  System       │  │  Core      │  │ Conversation│ │
│  │  Prompts      │  │  Memory    │  │ + Tools     │ │
│  │  ~4-5K tokens │  │  ~3K tokens│  │  ~185K+     │ │
│  └──────────────┘  └─────┬──────┘  └─────────────┘ │
└───────────────────────────┼─────────────────────────┘
                            │ always loaded
                            ▼
┌─────────────────────────────────────────────────────┐
│                  MEMORY STORES                       │
│                                                      │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐           │
│  │Episodic │  │ Semantic │  │Procedural│           │
│  │(chrono) │  │ (graph)  │  │(patterns)│           │
│  └────┬────┘  └────┬─────┘  └────┬─────┘           │
│       │             │             │                  │
│       └─────────────┼─────────────┘                  │
│                     ▼                                │
│            ┌─────────────────┐                       │
│            │  Vector Index   │                       │
│            │  + BM25 Search  │                       │
│            └─────────────────┘                       │
└─────────────────────────────────────────────────────┘
         ▲                              │
         │ retrieval on demand          │ periodic
         │                              ▼
┌─────────────────┐          ┌─────────────────────┐
│  TRIGGER ENGINE  │          │  REFLECTION ENGINE  │
│  remember/forget │          │  consolidate/prune  │
│  keyword detect  │          │  + user approval    │
│  + LLM routing   │          └─────────┬───────────┘
└────────┬────────┘                     │
         │                              │
         └──────────┬───────────────────┘
                    │ all mutations
                    ▼
         ┌─────────────────────┐
         │    AUDIT SYSTEM     │
         │  git + audit.log    │
         │  rollback, alerts   │
         └─────────────────────┘
```

---

## 3. File Structure

```
workspace/
├── MEMORY.md                          # CORE MEMORY — always in context (~3K tokens)
│                                      #   Blocks: [identity] [context] [persona] [critical]
│
├── memory/
│   ├── episodes/                      # EPISODIC — chronological, append-only
│   │   ├── 2026-02-01.md
│   │   ├── 2026-02-02.md
│   │   └── ...
│   │
│   ├── graph/                         # SEMANTIC — knowledge graph
│   │   ├── index.md                   # Graph topology: entities → relationships → entities
│   │   ├── entities/                  # One file per major entity
│   │   │   ├── person--alex.md
│   │   │   ├── project--moltbot-memory.md
│   │   │   └── concept--oauth2-pkce.md
│   │   └── relations.md              # Edge definitions and relationship types
│   │
│   ├── procedures/                    # PROCEDURAL — learned workflows
│   │   ├── how-to-deploy.md
│   │   ├── code-review-pattern.md
│   │   └── morning-briefing.md
│   │
│   ├── vault/                         # PINNED — user-protected, never auto-decayed
│   │   └── ...
│   │
│   └── meta/                          # SYSTEM — memory about memory
│       ├── decay-scores.json          # Relevance scores and access tracking
│       ├── reflection-log.md          # History of consolidation cycles
│       ├── pending-reflection.md      # Current reflection proposal awaiting approval
│       ├── pending-memories.md        # Sub-agent memory proposals awaiting commit
│       ├── evolution.md               # Long-term philosophical evolution tracker
│       └── audit.log                  # System-wide audit trail (all file mutations)
│
├── .audit/                            # AUDIT SNAPSHOTS — git-managed
│   └── (git repository tracking all workspace files)
```

---

## 4. Core Memory — MEMORY.md

Always loaded into context. Hard-capped at **3,000 tokens**. Divided into four blocks:

```markdown
# MEMORY.md — Core Memory

<!-- TOKEN BUDGET: ~3,000 tokens. Rewritten during reflection. -->

## Identity
<!-- ~500 tokens — Who is the user? What matters most about them? -->
- Name: [User Name]
- Role: [What they do]
- Communication style: [Direct, casual, formal, etc.]
- Key preferences: [Dark mode, Vim, TypeScript, etc.]
- Timezone: [TZ]

## Active Context
<!-- ~1,000 tokens — What's happening RIGHT NOW? Current projects, open decisions. -->
- Currently working on: [Project X — building memory architecture for moltbot]
- Open decisions: [Graph structure for semantic store, decay function parameters]
- Recent important events: [Completed research phase, chose hybrid architecture]
- Blockers/waiting on: [User approval of reflection proposal]

## Persona
<!-- ~500 tokens — How should I behave with this user? -->
- Relationship tenure: [Since YYYY-MM-DD]
- Interaction patterns: [Evening chats, deep technical discussions]
- Things I've learned about working with them: [Appreciates brainstorming, wants options before decisions]
- Emotional context: [Currently excited about the memory project]

## Critical Facts
<!-- ~1,000 tokens — Things I must NEVER forget, even if they haven't come up recently. -->
- [Fact 1 — high importance, pinned]
- [Fact 2 — high importance, pinned]
- ...
```

**Rules:**
- The agent can self-edit core memory mid-conversation when it learns something clearly important
- The reflection engine rewrites core memory during consolidation to keep it maximally relevant
- Users can pin items to Critical Facts to prevent decay
- If core memory exceeds 3K tokens after an edit, the agent must summarize/prune before continuing

---

## 5. Episodic Store — Chronological Event Memory

Each day gets an append-only log. Entries are timestamped and tagged.

```markdown
# 2026-02-02 — Episode Log

## 14:30 | decision | confidence:high | tags:[memory, architecture]
Discussed memory architecture directions with user. Chose hybrid approach:
multi-store cognitive model + Letta-style core memory always in context.
User decisions: LLM routing, decay forgetting, full consolidation, graph semantics.

## 15:45 | preference | confidence:medium | tags:[workflow]
User prefers brainstorming before implementation. Wants multiple options
presented with trade-offs before committing to a direction.

## 16:00 | task | confidence:high | tags:[memory, design]
Created comprehensive architecture document for the memory system.
Next: user review and iteration on specific components.
```

**Entry metadata schema:**
| Field | Type | Purpose |
|-------|------|---------|
| `timestamp` | ISO 8601 | When it happened |
| `type` | enum | `decision`, `fact`, `preference`, `task`, `event`, `emotion`, `correction` |
| `confidence` | enum | `high`, `medium`, `low` |
| `tags` | string[] | Topical tags for retrieval |
| `source` | string | `conversation`, `reflection`, `user-explicit` |

**Lifecycle:**
- Written during conversation when trigger keywords fire or when the agent detects memorable content
- Read by the reflection engine during consolidation
- Older episodes have their key facts extracted into the semantic graph
- Episodes themselves are never edited, only appended (append-only log)
- Subject to decay: episodes older than N days with no access have their search relevance reduced

---

## 6. Semantic Store — Knowledge Graph

This is where extracted, decontextualized knowledge lives. Organized as a lightweight graph in Markdown.

### 6.1 Graph Index (`graph/index.md`)

The topology file — maps all entities and their connections:

```markdown
# Semantic Graph Index

<!-- Auto-generated during reflection. Manual edits will be overwritten. -->

## Entity Registry
| ID | Type | Label | File | Decay Score |
|----|------|-------|------|-------------|
| person--alex | person | Alex | entities/person--alex.md | 1.00 (pinned) |
| project--moltbot-memory | project | Moltbot Memory System | entities/project--moltbot-memory.md | 0.95 |
| concept--oauth2-pkce | concept | OAuth2 PKCE Flow | entities/concept--oauth2-pkce.md | 0.72 |
| tool--openclaw | tool | OpenClaw/Moltbot | entities/tool--openclaw.md | 0.98 |

## Edges
| From | Relation | To | Confidence | First Seen | Last Accessed |
|------|----------|----|------------|------------|---------------|
| person--alex | develops | project--moltbot-memory | high | 2026-01-15 | 2026-02-02 |
| project--moltbot-memory | uses | tool--openclaw | high | 2026-01-15 | 2026-02-02 |
| project--moltbot-memory | decided-on | concept--oauth2-pkce | medium | 2026-01-20 | 2026-01-20 |
| person--alex | prefers | concept--brainstorm-first | high | 2026-02-02 | 2026-02-02 |
```

### 6.2 Entity Files (`graph/entities/*.md`)

Each entity gets a dedicated file with structured facts:

```markdown
# project--moltbot-memory

<!-- Type: project | Created: 2026-01-15 | Last updated: 2026-02-02 -->
<!-- Decay score: 0.95 | Access count: 14 | Pinned: no -->

## Summary
Building an intelligent memory system for Moltbot/OpenClaw agent. Goal is
human-like memory with natural language triggers, graph-structured semantics,
decay-based forgetting, and sleep-time consolidation.

## Facts
- Architecture: hybrid multi-store (episodic + semantic graph + procedural + core)
- Routing: LLM-classified (not keyword heuristic)
- Forgetting: decay model (not hard delete)
- Consolidation: full-memory audit during off-peak, token-capped
- Semantic store: graph-structured, not flat files
- Core memory budget: ~3,000 tokens

## Timeline
- 2026-01-15: Initial research into memory architectures began
- 2026-01-20: Reviewed Letta/MemGPT, Mem0, MIRIX papers
- 2026-02-02: Architecture direction chosen, design document drafted

## Open Questions
- Decay function parameters (half-life, floor)
- Reflection token budget cap
- Graph traversal depth for retrieval

## Relations
- Developed by: [[person--alex]]
- Built on: [[tool--openclaw]]
- Inspired by: [[concept--letta-sleep-time]], [[concept--cognitive-memory-systems]]
```

### 6.3 Relation Types (`graph/relations.md`)

Defines the vocabulary of edges:

```markdown
# Relation Types

## Structural
- `develops` — person → project
- `uses` / `used-by` — project ↔ tool/concept
- `part-of` / `contains` — hierarchical nesting
- `depends-on` — dependency relationship

## Temporal
- `decided-on` — a choice was made (with date)
- `supersedes` — newer fact replaces older
- `preceded-by` / `followed-by` — sequence

## Qualitative
- `prefers` — user preference
- `avoids` — user anti-preference
- `confident-about` / `uncertain-about` — epistemic status
- `relates-to` — general association
```

---

## 7. Procedural Store — Learned Workflows

Patterns the agent has learned for *how* to do things. These are templates, not events.

```markdown
# how-to-deploy.md

<!-- Type: procedure | Learned: 2026-01-25 | Last used: 2026-01-30 -->
<!-- Decay score: 0.85 | Access count: 3 -->

## Trigger
When user asks to deploy, push to production, or ship.

## Steps
1. Run test suite first (user insists on this)
2. Check for uncommitted changes
3. Use `git tag` for versioning (not just branch)
4. Deploy to staging before prod
5. Send notification to Slack #deployments channel

## Notes
- User prefers verbose deploy logs
- Always confirm before prod deploy (never auto-deploy)

## Learned From
- Episode 2026-01-25 14:30 — first deployment discussion
- Episode 2026-01-30 09:15 — refined after staging incident
```

---

## 8. Trigger System — Remember & Forget

### 8.1 Keyword Detection

The agent monitors conversation for trigger phrases. This runs as a lightweight check on every user message.

**Remember triggers** (write to memory):
```
"remember that..."
"don't forget..."
"keep in mind..."
"note that..."
"important:..."
"for future reference..."
"save this..."
"FYI for later..."
```

**Forget triggers** (decay/archive):
```
"forget about..."
"never mind about..."
"disregard..."
"that's no longer relevant..."
"scratch that..."
"ignore what I said about..."
"remove from memory..."
"delete the memory about..."
```

**Reflection triggers** (manual consolidation request):
```
"reflect on..."
"consolidate your memories..."
"what do you remember about...?" (triggers search, not write)
"review your memories..."
"clean up your memory..."
```

### 8.2 LLM Routing — Classification Prompt

When a remember trigger fires, the agent makes a classification call to determine *where* the memory goes:

```markdown
## Memory Router — Classification Prompt

You are classifying a piece of information for storage. Given the content below,
determine:

1. **Store**: Which memory store is most appropriate?
   - `core` — Critical, always-relevant information (identity, active priorities, key preferences)
   - `episodic` — A specific event, decision, or interaction worth logging chronologically
   - `semantic` — A fact, concept, or relationship that should be indexed in the knowledge graph
   - `procedural` — A workflow, pattern, or "how-to" that the agent should learn
   - `vault` — User explicitly wants this permanently protected from decay

2. **Entity extraction** (if semantic): What entities and relationships are present?
   - Entities: name, type (person/project/concept/tool/place)
   - Relations: subject → relation → object

3. **Tags**: 2-5 topical tags for retrieval

4. **Confidence**: How confident are we this is worth storing?
   - `high` — User explicitly asked us to remember, or it's clearly important
   - `medium` — Seems useful based on context
   - `low` — Might be relevant, uncertain

5. **Core-worthy?**: Should this also update MEMORY.md?
   - Only if it changes the user's identity, active context, or critical facts

Return as structured output:
{
  "store": "semantic",
  "entities": [{"name": "OAuth2 PKCE", "type": "concept"}],
  "relations": [{"from": "project--moltbot", "relation": "uses", "to": "concept--oauth2-pkce"}],
  "tags": ["auth", "security", "mobile"],
  "confidence": "high",
  "core_update": false,
  "summary": "Decided to use OAuth2 PKCE flow for mobile client auth."
}
```

### 8.3 Forget Processing

When a forget trigger fires:

1. **Identify target**: LLM extracts what the user wants to forget
2. **Find matches**: Search across all stores for matching content
3. **Present matches**: Show user what will be affected ("I found 3 memories about X. Should I archive all of them?")
4. **On confirmation**:
   - Set decay score to `0.0` (effectively hidden from search)
   - Move to `_archived` status in decay-scores.json
   - Remove from graph index (but don't delete entity file — soft archive)
   - If in core memory, remove from MEMORY.md
5. **Hard delete option**: User can explicitly say "permanently delete" to remove from disk

---

## 9. Decay Model — Intelligent Forgetting

Every memory entry has a **relevance score** that decays over time unless reinforced by access.

### 9.1 Decay Function

```
relevance(t) = base_relevance × e^(-λ × days_since_last_access) × log2(access_count + 1) × type_weight
```

Where:
- `base_relevance`: Initial importance (1.0 for explicit "remember", 0.7 for auto-detected, 0.5 for inferred)
- `λ` (lambda): Decay rate constant (recommended: **0.03** → half-life of ~23 days)
- `days_since_last_access`: Calendar days since the memory was last retrieved or referenced
- `access_count`: Total number of times this memory has been accessed
- `type_weight`: Multiplier by memory type:
  - Core: 1.5 (slow decay — these are important by definition)
  - Episodic: 0.8 (faster decay — events become less relevant)
  - Semantic: 1.2 (moderate — facts tend to persist)
  - Procedural: 1.0 (neutral — workflows either stay relevant or don't)
  - Vault/Pinned: ∞ (never decays)

### 9.2 Decay Thresholds

| Score Range | Status | Behavior |
|-------------|--------|----------|
| 1.0 - 0.5 | **Active** | Fully searchable, normal ranking |
| 0.5 - 0.2 | **Fading** | Searchable but deprioritized in results |
| 0.2 - 0.05 | **Dormant** | Only returned if explicitly searched or during full consolidation |
| < 0.05 | **Archived** | Hidden from search. Flagged for review during next consolidation |

### 9.3 Decay Scores File (`meta/decay-scores.json`)

```json
{
  "version": 1,
  "last_updated": "2026-02-02T16:00:00Z",
  "entries": {
    "episode:2026-02-02:14:30": {
      "store": "episodic",
      "base_relevance": 1.0,
      "created": "2026-02-02T14:30:00Z",
      "last_accessed": "2026-02-02T16:00:00Z",
      "access_count": 2,
      "type_weight": 0.8,
      "current_score": 0.92,
      "status": "active",
      "pinned": false
    },
    "entity:concept--oauth2-pkce": {
      "store": "semantic",
      "base_relevance": 0.7,
      "created": "2026-01-20T10:00:00Z",
      "last_accessed": "2026-01-20T10:00:00Z",
      "access_count": 1,
      "type_weight": 1.2,
      "current_score": 0.52,
      "status": "active",
      "pinned": false
    }
  }
}
```

### 9.4 Reinforcement

Memories are reinforced (access_count incremented, last_accessed updated) when:
- The memory is returned in a search result AND used in a response
- The user explicitly references the memory content
- The reflection engine identifies the memory as still-relevant during consolidation
- A new episode references or connects to the memory

---

## 10. Reflection Engine — Sleep-Time Consolidation

The most cognitively rich part of the system. Modeled on human sleep consolidation.

### 10.1 Trigger Conditions

Reflection runs when:
- **Scheduled**: Cron job during off-peak hours (e.g., 3:00 AM local time)
- **Session end**: When a long conversation concludes
- **Manual**: User says "reflect on your memories" or "consolidate"
- **Threshold**: When episodic store exceeds N unprocessed entries since last reflection

### 10.2 Token Budget

Each reflection cycle is capped at **8,000 tokens of processing output** (not input — the engine can *read* as much as it needs, but its *output* is bounded). This prevents runaway consolidation costs while allowing genuine depth.

### 10.3 Reflection Process

```
Phase 1: SURVEY (read everything, plan what to focus on)
   │  Read: core memory, recent episodes, graph index, decay scores
   │  Output: prioritized list of areas to consolidate
   │
Phase 2: META-REFLECTION (philosophical review)
   │  Read: reflection-log.md (all past reflections), evolution.md
   │  Consider:
   │    - Patterns recurring across reflections
   │    - How understanding of the user has evolved
   │    - Assumptions that have been revised
   │    - Persistent questions spanning multiple reflections
   │  Output: insights about cognitive evolution, guidance for this reflection
   │
Phase 3: CONSOLIDATE (extract, connect, prune — informed by meta-reflection)
   │  For each priority area:
   │    - Extract new facts from episodes → create/update graph entities
   │    - Identify new relationships → add edges to graph
   │    - Detect contradictions → flag for user review
   │    - Identify fading memories → propose archival
   │    - Identify patterns → create/update procedures
   │    - Note how changes relate to evolving understanding
   │
Phase 4: REWRITE CORE (update MEMORY.md)
   │  Rewrite core memory to reflect current state:
   │    - Update Active Context with latest priorities
   │    - Promote frequently-accessed facts to Critical
   │    - Demote stale items from core → archival
   │    - Evolve Persona section based on accumulated insights
   │    - Ensure total stays under 3K token cap
   │
Phase 5: SUMMARIZE (present to user for approval)
   │  Generate a human-readable reflection summary:
   │    - New facts learned
   │    - Connections discovered
   │    - Memories proposed for archival
   │    - Contradictions found
   │    - Core memory changes
   │    - Philosophical evolution insights
   │    - Questions for the user
   │
   ▼
Output: pending-reflection.md (awaits user approval)
        evolution.md updated (after approval)
```

### 10.4 Meta-Reflection — Philosophical Evolution

The meta-reflection phase enables the agent's understanding to deepen over time by reviewing the full history of past reflections before consolidating new memories.

**What it reads:**
- `reflection-log.md` — summaries of all past reflections
- `evolution.md` — accumulated philosophical insights and active threads

**What it considers:**
1. **Patterns across reflections** — recurring themes, types of knowledge extracted
2. **Evolution of understanding** — how perception of the user has changed
3. **Revised assumptions** — beliefs that have been corrected
4. **Persistent questions** — inquiries spanning multiple reflections
5. **Emergent insights** — patterns only visible across the full arc

**Output:**
- Guidance for the current reflection cycle
- Insights to add to `evolution.md`
- Context for how new memories relate to accumulated understanding

**Evolution Milestones:**
| Reflection # | Action |
|--------------|--------|
| 10 | First evolution summary — identify initial patterns |
| 25 | Consolidate evolution.md threads |
| 50 | Major synthesis — what has fundamentally changed? |
| 100 | Deep retrospective |

### 10.5 Reflection Summary Format (`meta/pending-reflection.md`)

```markdown
# Reflection Summary — 2026-02-02

## 🧠 New Knowledge Extracted
- Learned that Alex prefers hybrid approaches over pure implementations
- Extracted architectural decision: decay model for forgetting (not hard delete)
- New entity: concept--sleep-time-compute (connected to project--moltbot-memory)

## 🔗 New Connections
- person--alex → prefers → concept--brainstorm-first (NEW)
- project--moltbot-memory → inspired-by → concept--letta-sleep-time (NEW)

## 📦 Proposed Archival (decay score < 0.05)
- Episode 2025-12-15: discussion about unrelated CSS bug (score: 0.03)
- Entity: concept--old-api-key-rotation (score: 0.04, last accessed 45 days ago)

## ⚠️ Contradictions Detected
- None this cycle

## ✏️ Core Memory Changes
```diff
## Active Context
- Currently working on: [research phase of memory architecture]
+ Currently working on: [design document for memory architecture — research complete]
+ Open decisions: [decay parameters, reflection token budget, implementation order]
```

## 🌱 Philosophical Evolution
### What I've Learned About Learning
This reflection continues a pattern from Reflection #3: Alex values systematic 
approaches but wants flexibility within structure.

### Evolving Understanding
My understanding of Alex's work style has deepened — they think in architectures
and systems, preferring to establish foundations before building features.

### Emergent Theme
Across 5 reflections, I notice Alex consistently chooses "both/and" over "either/or"
solutions (hybrid memory model, soft migration, gated write access).

## ❓ Questions for You
- Should I pin the memory architecture decisions to the vault? They seem foundational.
- The OAuth2 PKCE fact hasn't been accessed in 13 days. Still relevant?

---
**Reflection #**: 5
**Token budget used**: 5,200 / 8,000
**Memories processed**: 23 episodes, 8 entities, 3 procedures
**Reflections reviewed**: 4 past reflections
**Next scheduled reflection**: 2026-02-03 03:00

> Reply with `approve`, `approve with changes`, or `reject` to apply this reflection.
```

### 10.6 User Approval Flow

1. Agent presents `pending-reflection.md` summary
2. User can:
   - **`approve`** — All changes applied immediately
   - **`approve with changes`** — User specifies modifications ("don't archive the CSS bug, I might need it")
   - **`reject`** — Nothing applied, agent notes the rejection for learning
   - **`partial approve`** — Accept some changes, reject others
3. Approved changes are applied atomically and logged in `reflection-log.md`
4. `evolution.md` is updated with this reflection's philosophical insights
5. If no response within 24 hours, reflection remains pending (never auto-applied)

---

## 11. Retrieval — How the Agent Remembers

When the agent needs to recall information:

### 11.1 Retrieval Strategy by Query Type

| Query Type | Primary Store | Strategy |
|------------|---------------|----------|
| "When did we...?" | Episodic | Temporal scan + keyword |
| "What do you know about X?" | Semantic graph | Entity lookup → traverse edges |
| "How do I usually...?" | Procedural | Pattern match on trigger |
| "What's the latest on...?" | Episodic + Core | Recent episodes + active context |
| General context | Core memory | Already in context — no retrieval needed |

### 11.2 Graph Traversal for Semantic Queries

When a semantic query fires:
1. **Entity resolution**: Map the query to a graph entity (fuzzy match on names/aliases)
2. **Direct lookup**: Read the entity file for immediate facts
3. **1-hop traversal**: Follow edges to related entities (depth 1)
4. **2-hop traversal**: If needed, follow edges to entities related to related entities (depth 2, capped)
5. **Assemble context**: Combine entity facts + relationship context into a retrieval snippet

Example: "What do you know about the memory project?"
→ Resolve to `project--moltbot-memory`
→ Read entity file (summary, facts, timeline)
→ 1-hop: person--alex (develops), tool--openclaw (built on), concept--letta-sleep-time (inspired by)
→ Return: structured context about the project + its connections

### 11.3 Hybrid Search

For ambiguous queries, run both:
- **Vector search** (semantic similarity via embeddings) across all stores
- **BM25 keyword search** (exact token matching for IDs, names, code symbols)
- **Graph traversal** (for relationship-aware queries)

Merge results, deduplicate, rank by relevance score × decay score.

---

## 12. Audit Trail — System-Wide Change Tracking

Every mutation to any system file is tracked. This covers the entire agent workspace — not just memory stores, but persona files, configuration, identity, and tools.

### 12.1 Scope — What Gets Tracked

| File | Change Frequency | Typical Actor | Sensitivity |
|------|-----------------|---------------|-------------|
| SOUL.md | Rare | Human only | 🔴 Critical — behavioral constitution |
| IDENTITY.md | Rare | Human / first-run | 🔴 Critical — agent identity |
| USER.md | Occasional | Reflection engine (approved) | 🟡 High — human context |
| TOOLS.md | Occasional | Human / system | 🟡 High — capability definitions |
| MEMORY.md | Frequent | Bot, reflection, user triggers | 🟢 Standard — dynamic working memory |
| memory/episodes/* | Frequent | Bot (append-only) | 🟢 Standard — chronological logs |
| memory/graph/* | Frequent | Bot, reflection | 🟢 Standard — knowledge graph |
| memory/procedures/* | Occasional | Bot, reflection | 🟢 Standard — learned workflows |
| memory/vault/* | Rare | Human only (pins) | 🟡 High — protected memories |
| memory/meta/* | Frequent | System, reflection | 🟢 Standard — system metadata |
| Config (moltbot.json) | Rare | Human only | 🔴 Critical — system configuration |

### 12.2 Dual-Layer Architecture

The audit system uses two layers — git for ground truth, and a lightweight log for fast querying.

```
┌─────────────────────────────────────────────────────┐
│                   AUDIT SYSTEM                       │
│                                                      │
│  Layer 1: Git (ground truth)                        │
│  ┌────────────────────────────────────────────────┐ │
│  │  Every mutation = git commit                    │ │
│  │  Full diff history, revertable, blameable       │ │
│  │  Author tag identifies actor                    │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  Layer 2: Audit Log (queryable summary)             │
│  ┌────────────────────────────────────────────────┐ │
│  │  memory/meta/audit.log                          │ │
│  │  One-line-per-mutation, compact format           │ │
│  │  Searchable by bot without parsing git           │ │
│  │  Periodically pruned / summarized                │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  Alerts                                              │
│  ┌────────────────────────────────────────────────┐ │
│  │  ⚠️ Unexpected edits to critical files           │ │
│  │  Flag SOUL.md / IDENTITY.md / config changes    │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 12.3 Git Layer — Ground Truth

The workspace is a git repository. Every file mutation generates a commit.

**Commit format:**
```
[ACTION] FILE — SUMMARY

Actor: ACTOR_TYPE:ACTOR_ID
Approval: APPROVAL_STATUS
Trigger: TRIGGER_SOURCE
```

**Examples:**
```
[EDIT] MEMORY.md — updated Active Context with memory project status

Actor: bot:trigger-remember
Approval: auto
Trigger: user said "remember we chose the hybrid approach"
```

```
[EDIT] USER.md — added timezone preference

Actor: reflection:r-012
Approval: approved
Trigger: reflection session 2026-02-03
```

```
[EDIT] SOUL.md — modified core behavioral guideline

Actor: manual
Approval: —
Trigger: direct human edit
⚠️ CRITICAL FILE CHANGED
```

**Actor tags:**
| Actor | Format | Meaning |
|-------|--------|---------|
| User-triggered memory | `bot:trigger-remember` | Bot wrote memory from user's "remember" command |
| User-triggered forget | `bot:trigger-forget` | Bot archived memory from user's "forget" command |
| Auto-detected | `bot:auto-detect` | Bot noticed something worth remembering without explicit trigger |
| Reflection engine | `reflection:SESSION_ID` | Reflection proposed and user approved this change |
| Decay system | `system:decay` | Automatic decay threshold transition |
| Manual human edit | `manual` | Human edited file directly |
| Skill/plugin | `skill:SKILL_NAME` | External skill or plugin modified a file |
| System init | `system:init` | First-run or migration |
| Sub-agent proposal | `subagent:AGENT_NAME` | Sub-agent proposed a memory (pending commit) |
| Sub-agent commit | `bot:commit-from:AGENT_NAME` | Main agent committed a sub-agent's proposal |

### 12.4 Audit Log — Queryable Summary

`memory/meta/audit.log` is a compact, one-line-per-entry log the bot can search quickly without shelling out to git.

**Format:**
```
TIMESTAMP | ACTION | FILE | ACTOR | APPROVAL | SUMMARY
```

**Example entries:**
```
2026-02-02T15:30Z | EDIT   | MEMORY.md                | bot:trigger-remember | auto     | added "hybrid approach chosen" to Active Context
2026-02-02T15:31Z | CREATE | memory/graph/entities/concept--hybrid-arch.md | bot:trigger-remember | auto     | new entity from user "remember" command
2026-02-02T16:00Z | APPEND | memory/episodes/2026-02-02.md | bot:auto-detect | auto     | logged architecture discussion
2026-02-03T03:00Z | EDIT   | MEMORY.md                | reflection:r-012     | approved | rewrote Active Context and Critical Facts
2026-02-03T03:00Z | EDIT   | USER.md                  | reflection:r-012     | approved | added timezone preference to Context
2026-02-03T03:00Z | MERGE  | memory/graph/entities/*  | reflection:r-012     | approved | consolidated 3 duplicate entities
2026-02-03T03:01Z | DECAY  | memory/meta/decay-scores.json | system:decay    | auto     | 2 entries transitioned: fading→dormant
2026-02-05T10:00Z | EDIT   | SOUL.md                  | manual               | —        | ⚠️ CRITICAL: behavioral guideline modified
2026-02-06T12:00Z | REVERT | MEMORY.md                | manual               | —        | user reverted to commit abc1234
```

**Actions vocabulary:**
| Action | Meaning |
|--------|---------|
| CREATE | New file created |
| EDIT | Existing file modified |
| APPEND | Content added without modifying existing content (episode logs) |
| DELETE | File removed from disk (hard delete) |
| ARCHIVE | File soft-deleted (decay score zeroed, removed from indices) |
| MERGE | Multiple files/entries consolidated into one |
| REVERT | File restored to a previous version |
| DECAY | Decay system transitioned a memory's status |
| RENAME | File moved or renamed |

### 12.5 Critical File Alerts

Files marked 🔴 Critical in the scope table receive special treatment:

1. **Any edit triggers an alert** — the bot should surface the change to the user at the start of the next conversation: "Heads up — SOUL.md was modified on [date]. Here's what changed: [diff summary]. Was this intentional?"

2. **Unauthorized edit detection** — if a critical file changes and the actor is not `manual` (human) or an approved reflection, the bot should flag it immediately as a potential integrity issue.

3. **Checksum validation** — on startup, the bot can compare critical file checksums against the last known good state to detect tampering between sessions.

**Alert format in audit.log:**
```
2026-02-05T10:00Z | EDIT | SOUL.md | manual | — | ⚠️ CRITICAL: behavioral guideline modified
2026-02-05T10:01Z | ALERT | SOUL.md | system:audit | — | Critical file change detected. Pending user acknowledgment.
```

### 12.6 Retention & Pruning

The audit log grows continuously. To prevent bloat:

- **Git history**: Retained indefinitely (it's compressed and cheap). This is the permanent record.
- **Audit log file**: Rolling 90-day window. Entries older than 90 days are summarized into `memory/meta/audit-archive.md` (monthly digests) and pruned from the active log.
- **Monthly digest format**:

```markdown
# Audit Digest — January 2026

## Summary
- 142 total mutations across 18 files
- 12 reflection sessions (10 approved, 1 partial, 1 rejected)
- 0 critical file changes
- 34 decay transitions, 8 archival events

## Notable Events
- 2026-01-15: Memory system project initiated
- 2026-01-20: 5 new entities added after research session
- 2026-01-25: First procedural memory created (deployment workflow)
```

### 12.7 Querying the Audit Trail

The bot can answer audit questions by searching the log:

| User Question | Query Strategy |
|---------------|----------------|
| "What changed recently?" | Tail the audit.log, last N entries |
| "Why did you forget about X?" | Search audit.log for ARCHIVE/DECAY actions matching X |
| "What happened during the last reflection?" | Filter by actor = `reflection:*`, last session |
| "Has SOUL.md ever been changed?" | `grep SOUL.md audit.log` or `git log SOUL.md` |
| "Revert my memory to yesterday" | `git log --before=yesterday`, identify commit, `git checkout` |
| "Who changed USER.md?" | `git blame USER.md` or search audit.log for USER.md |

### 12.8 Rollback Procedure

Because git tracks everything, any change can be reverted:

1. **Single file rollback**: `git checkout <commit> -- <file>` to restore one file to a previous state
2. **Full session rollback**: Revert all changes from a specific reflection session by reverting its commits
3. **Point-in-time rollback**: Restore the entire workspace to a specific date/time

After any rollback:
- A new audit entry is logged with action `REVERT`
- The decay-scores.json is recalculated to match the restored state
- The graph index is rebuilt if semantic files were affected

---

## 13. Multi-Agent Memory Access

Moltbot uses multiple sub-agents (e.g., researcher, coder, reviewer). This section defines how they interact with the shared memory system.

### 13.1 Access Model: Shared Read, Gated Write

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY STORES                             │
│  (Episodic, Semantic, Procedural, Core, Vault)              │
└─────────────────────────────────────────────────────────────┘
         ▲                              │
         │ READ (all agents)            │ WRITE (main agent only)
         │                              │
┌────────┴────────────────────────────────────────────────────┐
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Main    │  │ Research │  │  Coder   │  │ Reviewer │   │
│  │  Agent   │  │  Agent   │  │  Agent   │  │  Agent   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│       │ COMMIT      └─────────────┴─────────────┘          │
│       │                         │                          │
│       │                         │ PROPOSE                  │
│       │                         ▼                          │
│       │             ┌─────────────────────┐                │
│       │             │  pending-memories   │                │
│       │             │  (staging area)     │                │
│       │             └─────────────────────┘                │
│       │                         │                          │
│       └─────────────────────────┘                          │
│                   review & commit                          │
└─────────────────────────────────────────────────────────────┘
```

**Rules:**
- **All agents can READ** all memory stores (core, episodic, semantic, procedural, vault)
- **Only the main agent can WRITE** directly to memory stores
- **Sub-agents PROPOSE** memories by appending to `memory/meta/pending-memories.md`
- **Main agent REVIEWS** proposals and commits approved ones to the actual stores
- **Reflection engine** can also process pending memories during consolidation

### 13.2 Pending Memories Format

Sub-agents write proposals to `memory/meta/pending-memories.md`:

```markdown
# Pending Memory Proposals

<!-- Sub-agents append proposals here. Main agent reviews and commits. -->

---
## Proposal #1
- **From**: researcher
- **Timestamp**: 2026-02-03T10:00:00Z
- **Trigger**: auto-detect during research task
- **Suggested store**: semantic
- **Content**: User prefers academic sources over blog posts for technical topics
- **Entities**: [preference--source-quality]
- **Confidence**: medium
- **Core-worthy**: no
- **Status**: pending

---
## Proposal #2
- **From**: coder
- **Timestamp**: 2026-02-03T10:15:00Z
- **Trigger**: user said "remember this pattern"
- **Suggested store**: procedural
- **Content**: When refactoring, user wants tests written before changing implementation
- **Entities**: [procedure--refactoring-workflow]
- **Confidence**: high
- **Core-worthy**: no
- **Status**: pending
```

### 13.3 Main Agent Commit Flow

When the main agent processes pending memories:

1. **Review** each pending proposal
2. **Validate** — is this worth storing? Is the classification correct?
3. **Decide**:
   - `commit` — write to the suggested store (or override to a different store)
   - `reject` — remove from pending, optionally log reason
   - `defer` — leave for reflection engine to handle
4. **Execute** — write to store, update decay scores, update graph if needed
5. **Audit** — log with actor `bot:commit-from:AGENT_NAME`
6. **Clear** — remove committed/rejected proposals from pending file

### 13.4 Automatic vs. Manual Review

| Mode | Behavior | When to use |
|------|----------|-------------|
| **Auto-commit** | High-confidence proposals from trusted sub-agents are committed immediately | Stable system, trusted agents |
| **Batch review** | Main agent reviews all pending at session start or end | Default recommended mode |
| **Manual review** | User reviews proposals (like reflection) | High-stakes or sensitive context |

**Recommended default: Batch review** — main agent processes pending memories at the start of each session or when explicitly triggered.

### 13.5 Sub-Agent Instructions

Each sub-agent should include in their system prompt:

```markdown
## Memory Access

You have READ access to all memory stores:
- MEMORY.md (core) — always in your context
- memory/episodes/* — chronological event logs
- memory/graph/* — knowledge graph entities and relationships
- memory/procedures/* — learned workflows
- memory/vault/* — pinned memories

You do NOT have direct WRITE access. To remember something:
1. Append a proposal to `memory/meta/pending-memories.md`
2. Use this format:
   ---
   ## Proposal #N
   - **From**: [your agent name]
   - **Timestamp**: [ISO 8601]
   - **Trigger**: [what triggered this — user command or auto-detect]
   - **Suggested store**: [episodic | semantic | procedural | vault]
   - **Content**: [the actual memory content]
   - **Entities**: [if semantic, list entity IDs]
   - **Confidence**: [high | medium | low]
   - **Core-worthy**: [yes | no]
   - **Status**: pending
3. The main agent will review and commit approved proposals

Do NOT attempt to write directly to memory stores. Your proposals will be
reviewed to ensure memory coherence across all agents.
```

### 13.6 Conflict Resolution

When multiple sub-agents propose conflicting memories:

1. **Detection** — main agent or reflection engine identifies contradiction
2. **Flagging** — both proposals marked with `⚠️ CONFLICT` status
3. **Resolution options**:
   - Main agent decides which is correct
   - Both are stored with `confidence: low` and linked as contradictory
   - User is asked to resolve during next interaction
4. **Audit** — conflict and resolution logged

Example conflict flag in pending-memories.md:
```markdown
## Proposal #3 ⚠️ CONFLICT with #4
- **From**: researcher
- **Content**: Project deadline is March 15
- **Status**: conflict — see #4

## Proposal #4 ⚠️ CONFLICT with #3
- **From**: coder
- **Content**: Project deadline is March 30
- **Status**: conflict — see #3
```

### 13.7 Audit Trail for Multi-Agent

Sub-agent memory operations are fully tracked:

```
2026-02-03T10:00Z | PROPOSE | memory/meta/pending-memories.md | subagent:researcher | pending  | "User prefers academic sources"
2026-02-03T10:15Z | PROPOSE | memory/meta/pending-memories.md | subagent:coder      | pending  | "Refactoring workflow"
2026-02-03T10:30Z | COMMIT  | memory/graph/entities/...       | bot:commit-from:researcher | auto | accepted proposal #1
2026-02-03T10:30Z | COMMIT  | memory/procedures/...           | bot:commit-from:coder      | auto | accepted proposal #2
2026-02-03T10:31Z | REJECT  | memory/meta/pending-memories.md | bot:main            | auto     | rejected proposal #5 — duplicate
```

---

## 14. AGENTS.md Instructions

Add to your AGENTS.md for agent behavior:

```markdown
## Memory System

### Always-Loaded Context
Your MEMORY.md (core memory) is always in your context window. Use it as your
primary awareness of who the user is and what matters right now. You don't need
to search for information that's already in your core memory.

### Trigger Detection
Monitor every user message for memory trigger phrases:

**Remember triggers**: "remember", "don't forget", "keep in mind", "note that",
"important:", "for future reference", "save this", "FYI for later"
→ Action: Classify via LLM routing prompt, write to appropriate store, update
  decay scores. If core-worthy, also update MEMORY.md.

**Forget triggers**: "forget about", "never mind", "disregard", "no longer relevant",
"scratch that", "ignore what I said about", "remove from memory", "delete memory"
→ Action: Identify target, find matches, confirm with user, set decay to 0.

**Reflection triggers**: "reflect on", "consolidate memories", "review memories",
"clean up memory"
→ Action: Run reflection cycle, present summary for approval.

### Memory Writes
When writing a memory:
1. Call the routing classifier to determine store + metadata
2. Write to the appropriate file
3. Update decay-scores.json with new entry
4. If the memory creates a new entity or relationship, update graph/index.md
5. If core-worthy, update MEMORY.md (respecting 3K token cap)

### Memory Reads
Before answering questions about prior work, decisions, people, preferences:
1. Check core memory first (it's already in context)
2. If not found, run memory_search across all stores
3. For relationship queries, use graph traversal
4. For temporal queries ("when did we..."), scan episodes
5. If low confidence after search, say you checked but aren't sure

### Self-Editing Core Memory
You may update MEMORY.md mid-conversation when:
- You learn something clearly important about the user
- The active context has shifted significantly
- A critical fact needs correction
Always respect the 3K token cap. If an addition would exceed it, summarize or
remove the least-relevant item.

### Reflection
During scheduled reflection or when manually triggered:
- Follow the 4-phase process (Survey → Consolidate → Rewrite Core → Summarize)
- Stay within the 8,000 token output budget
- NEVER apply changes without user approval
- Present the summary in the pending-reflection.md format
- Log all approved changes in reflection-log.md

### Audit Trail
Every file mutation must be tracked. When writing, editing, or deleting any file:
1. Commit the change to git with a structured message (actor, approval, trigger)
2. Append a one-line entry to `memory/meta/audit.log`
3. If the changed file is SOUL.md, IDENTITY.md, or config — flag as ⚠️ CRITICAL

On session start:
- Check if any critical files changed since last session
- If yes, alert the user: "SOUL.md was modified on [date]. Was this intentional?"

When user asks about memory changes:
- Search audit.log for relevant entries
- For detailed diffs, use git history
- Support rollback requests via git checkout

### Multi-Agent Memory (for sub-agents)
If you are a sub-agent (not the main orchestrator):
- You have READ access to all memory stores
- You do NOT have direct WRITE access
- To remember something, append a proposal to `memory/meta/pending-memories.md`:
  ```
  ---
  ## Proposal #N
  - **From**: [your agent name]
  - **Timestamp**: [ISO 8601]
  - **Trigger**: [user command or auto-detect]
  - **Suggested store**: [episodic | semantic | procedural | vault]
  - **Content**: [the memory content]
  - **Entities**: [entity IDs if semantic]
  - **Confidence**: [high | medium | low]
  - **Core-worthy**: [yes | no]
  - **Status**: pending
  ```
- The main agent will review and commit approved proposals

### Multi-Agent Memory (for main agent)
At session start or when triggered:
1. Check `memory/meta/pending-memories.md` for proposals
2. Review each pending proposal
3. For each: commit (write to store), reject (remove), or defer (leave for reflection)
4. Log commits with actor `bot:commit-from:AGENT_NAME`
5. Clear processed proposals from pending file
```

---

## 15. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Create file structure (all directories and template files)
- [ ] Initialize git repository in workspace root
- [ ] Implement audit log writer (append to `memory/meta/audit.log`)
- [ ] Implement git auto-commit on file mutation (with structured message format)
- [ ] Implement trigger keyword detection in AGENTS.md
- [ ] Build LLM routing classifier prompt
- [ ] Implement basic episodic logging (append to daily files)
- [ ] Wire up MEMORY.md as always-loaded core memory

### Phase 2: Semantic Graph (Week 3-4)
- [ ] Design entity file template
- [ ] Build graph/index.md auto-generation
- [ ] Implement entity extraction from episodes
- [ ] Build graph traversal for retrieval (1-hop and 2-hop)
- [ ] Integrate graph search with existing vector search

### Phase 3: Decay System (Week 5)
- [ ] Implement decay-scores.json tracking
- [ ] Build decay function calculator
- [ ] Add access tracking (increment on retrieval)
- [ ] Implement status transitions (active → fading → dormant → archived)
- [ ] Add pinning mechanism for vault items

### Phase 4: Reflection Engine (Week 6-8)
- [ ] Build reflection trigger (cron + manual + threshold)
- [ ] Implement 4-phase reflection process
- [ ] Build pending-reflection.md generation
- [ ] Implement user approval flow (approve/reject/partial)
- [ ] Build core memory rewriting with token cap enforcement
- [ ] Test with real conversation data

### Phase 5: Multi-Agent Support (Week 9-10)
- [ ] Create pending-memories.md staging file and format
- [ ] Implement sub-agent proposal writing (append to staging)
- [ ] Build main agent review flow (commit/reject/defer)
- [ ] Add conflict detection for contradictory proposals
- [ ] Integrate pending memory processing into reflection engine
- [ ] Update sub-agent system prompts with memory access instructions
- [ ] Test with all 4 sub-agents

### Phase 6: Polish & Iterate (Week 11+)
- [ ] Tune decay parameters with real usage data
- [ ] Optimize graph traversal performance
- [ ] Add contradiction detection
- [ ] Implement critical file alert system (session-start checksum validation)
- [ ] Build audit log pruning + monthly digest generation
- [ ] Build memory health dashboard (optional)
- [ ] Write comprehensive SKILL.md for community sharing

---

## 16. Key Parameters — Quick Reference

| Parameter | Recommended | Tunable? | Notes |
|-----------|-------------|----------|-------|
| Core memory cap | 3,000 tokens | Yes | Trade-off: more context vs. window space |
| Decay lambda (λ) | 0.03 | Yes | Higher = faster forgetting. 0.03 → ~23 day half-life |
| Decay archive threshold | 0.05 | Yes | Below this, memory is hidden from search |
| Reflection token budget | 8,000 tokens | Yes | Output cap per reflection cycle |
| Reflection frequency | Daily + session-end | Yes | More frequent = more current, but more expensive |
| Graph traversal depth | 2 hops | Yes | Deeper = richer context, slower retrieval |
| Max search results | 20 | Yes | Per the existing memorySearch config |
| Min search score | 0.3 | Yes | Per the existing memorySearch config |
| Audit log retention | 90 days | Yes | Older entries summarized into monthly digests |
| Critical file alerts | On | Yes | Alert on SOUL.md, IDENTITY.md, config changes |
| Git commit on mutation | Always | No | Every file change = one atomic commit |

---

## 17. Open Design Decisions

These emerged during this design phase and need resolution during implementation:

1. **Entity deduplication**: When the agent extracts an entity that's similar but not identical to an existing one ("OAuth PKCE" vs "OAuth2 PKCE flow"), how aggressive should merging be?

2. **Cross-session episode boundaries**: Should a single long conversation be one episode entry or broken into topic-based chunks?

3. **Graph size limits**: Should there be a cap on total entities/edges? At what point does the graph become too large for the reflection engine to survey?

4. **Multi-user support (group chats)**: The current design is single-user. If the bot serves multiple *human users* (e.g., group chats, team workspaces), how should memories be scoped? (Note: multi-*agent* access is addressed in § 13 — this is about multiple humans.)

5. **Memory import**: Should there be a mechanism to bulk-import knowledge (e.g., "read this PDF and add it to your semantic memory")?

---

*This is a living document. It will evolve as implementation reveals what works and what doesn't.*
