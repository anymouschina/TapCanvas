#!/bin/bash
# cognitive-memory init script
# Usage: bash init_memory.sh /path/to/workspace

set -e

WORKSPACE="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATES="$SKILL_DIR/assets/templates"

echo "🧠 Initializing cognitive memory system in: $WORKSPACE"

# --- Create directory structure ---
echo "📁 Creating directory structure..."
mkdir -p "$WORKSPACE/memory/episodes"
mkdir -p "$WORKSPACE/memory/graph/entities"
mkdir -p "$WORKSPACE/memory/procedures"
mkdir -p "$WORKSPACE/memory/vault"
mkdir -p "$WORKSPACE/memory/meta"
mkdir -p "$WORKSPACE/memory/meta/reflections"
mkdir -p "$WORKSPACE/memory/meta/reflections/dialogues"
mkdir -p "$WORKSPACE/memory/meta/rewards"

# --- Copy templates ---
echo "📋 Copying templates..."

# Core memory
if [ ! -f "$WORKSPACE/MEMORY.md" ]; then
    cp "$TEMPLATES/MEMORY.md" "$WORKSPACE/MEMORY.md"
    echo "   ✅ Created MEMORY.md"
else
    echo "   ⏭️  MEMORY.md already exists, skipping"
fi

# Identity
if [ ! -f "$WORKSPACE/IDENTITY.md" ]; then
    cp "$TEMPLATES/IDENTITY.md" "$WORKSPACE/IDENTITY.md"
    echo "   ✅ Created IDENTITY.md"
else
    echo "   ⏭️  IDENTITY.md already exists, skipping"
fi

# Soul
if [ ! -f "$WORKSPACE/SOUL.md" ]; then
    cp "$TEMPLATES/SOUL.md" "$WORKSPACE/SOUL.md"
    echo "   ✅ Created SOUL.md"
else
    echo "   ⏭️  SOUL.md already exists, skipping"
fi

# Graph templates
if [ ! -f "$WORKSPACE/memory/graph/index.md" ]; then
    cp "$TEMPLATES/graph-index.md" "$WORKSPACE/memory/graph/index.md"
    echo "   ✅ Created graph/index.md"
fi

if [ ! -f "$WORKSPACE/memory/graph/relations.md" ]; then
    cp "$TEMPLATES/relations.md" "$WORKSPACE/memory/graph/relations.md"
    echo "   ✅ Created graph/relations.md"
fi

# Meta files
if [ ! -f "$WORKSPACE/memory/meta/decay-scores.json" ]; then
    cp "$TEMPLATES/decay-scores.json" "$WORKSPACE/memory/meta/decay-scores.json"
    echo "   ✅ Created meta/decay-scores.json"
fi

if [ ! -f "$WORKSPACE/memory/meta/reflection-log.md" ]; then
    cp "$TEMPLATES/reflection-log.md" "$WORKSPACE/memory/meta/reflection-log.md"
    echo "   ✅ Created meta/reflection-log.md"
fi

if [ ! -f "$WORKSPACE/memory/meta/reward-log.md" ]; then
    cp "$TEMPLATES/reward-log.md" "$WORKSPACE/memory/meta/reward-log.md"
    echo "   ✅ Created meta/reward-log.md"
fi

if [ ! -f "$WORKSPACE/memory/meta/audit.log" ]; then
    echo "# Audit Log — Cognitive Memory System" > "$WORKSPACE/memory/meta/audit.log"
    echo "# Format: TIMESTAMP | ACTION | FILE | ACTOR | APPROVAL | SUMMARY" >> "$WORKSPACE/memory/meta/audit.log"
    echo "" >> "$WORKSPACE/memory/meta/audit.log"
    echo "   ✅ Created meta/audit.log"
fi

if [ ! -f "$WORKSPACE/memory/meta/pending-memories.md" ]; then
    cp "$TEMPLATES/pending-memories.md" "$WORKSPACE/memory/meta/pending-memories.md"
    echo "   ✅ Created meta/pending-memories.md"
fi

if [ ! -f "$WORKSPACE/memory/meta/evolution.md" ]; then
    cp "$TEMPLATES/evolution.md" "$WORKSPACE/memory/meta/evolution.md"
    echo "   ✅ Created meta/evolution.md"
fi

if [ ! -f "$WORKSPACE/memory/meta/pending-reflection.md" ]; then
    cp "$TEMPLATES/pending-reflection.md" "$WORKSPACE/memory/meta/pending-reflection.md"
    echo "   ✅ Created meta/pending-reflection.md"
fi

# --- Initialize git ---
echo "🔍 Setting up git audit tracking..."
cd "$WORKSPACE"

if [ ! -d ".git" ]; then
    git init -q
    git add -A
    git commit -q -m "[INIT] Cognitive memory system initialized

Actor: system:init
Approval: auto
Trigger: init_memory.sh"
    echo "   ✅ Git repository initialized"
else
    echo "   ⏭️  Git repository already exists"
fi

# --- Summary ---
echo ""
echo "✅ Cognitive memory system initialized!"
echo ""
echo "Directory structure:"
echo "  $WORKSPACE/"
echo "  ├── MEMORY.md                     (core memory)"
echo "  ├── IDENTITY.md                   (facts + self-image)"
echo "  ├── SOUL.md                       (values, principles)"
echo "  ├── memory/"
echo "  │   ├── episodes/                 (daily logs)"
echo "  │   ├── graph/                    (knowledge graph)"
echo "  │   ├── procedures/               (learned workflows)"
echo "  │   ├── vault/                    (pinned memories)"
echo "  │   └── meta/"
echo "  │       ├── decay-scores.json     (tracking + token economy)"
echo "  │       ├── reflection-log.md     (summaries)"
echo "  │       ├── reflections/          (full archive)"
echo "  │       │   └── dialogues/        (post-reflection conversations)"
echo "  │       ├── reward-log.md         (result + reason)"
echo "  │       ├── rewards/              (full requests)"
echo "  │       ├── evolution.md"
echo "  │       └── audit.log"
echo "  └── .git/                         (audit ground truth)"
echo ""
echo "Next steps:"
echo "  1. Update config to enable memorySearch"
echo "  2. Append assets/templates/agents-memory-block.md to AGENTS.md"
echo "  3. Customize IDENTITY.md and SOUL.md for your agent"
echo "  4. Test: 'Remember that I prefer dark mode.'"
