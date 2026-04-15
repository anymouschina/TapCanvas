#!/bin/bash
# cognitive-memory upgrade script to v1.0.6
# Usage: bash upgrade_to_1.0.6.sh [/path/to/workspace]

set -e

# --- Configuration ---
WORKSPACE="${1:-$HOME/.openclaw/workspace}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATES="$SKILL_DIR/assets/templates"
VERSION="1.0.6"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧠 Cognitive Memory Upgrade to v${VERSION}${NC}"
echo "   Workspace: $WORKSPACE"
echo ""

# --- Pre-flight checks ---
if [ ! -d "$WORKSPACE" ]; then
    echo -e "${RED}❌ Workspace not found: $WORKSPACE${NC}"
    echo "   Usage: bash upgrade_to_1.0.6.sh /path/to/workspace"
    exit 1
fi

if [ ! -d "$WORKSPACE/memory" ]; then
    echo -e "${RED}❌ No memory directory found. Is cognitive-memory installed?${NC}"
    echo "   Run init_memory.sh first for new installations."
    exit 1
fi

# --- Backup ---
BACKUP_DIR="$WORKSPACE/.cognitive-memory-backup-$(date +%Y%m%d-%H%M%S)"
echo -e "${YELLOW}📦 Creating backup...${NC}"
mkdir -p "$BACKUP_DIR"
cp -r "$WORKSPACE/memory" "$BACKUP_DIR/" 2>/dev/null || true
cp "$WORKSPACE/MEMORY.md" "$BACKUP_DIR/" 2>/dev/null || true
cp "$WORKSPACE/IDENTITY.md" "$BACKUP_DIR/" 2>/dev/null || true
cp "$WORKSPACE/SOUL.md" "$BACKUP_DIR/" 2>/dev/null || true
echo -e "   ${GREEN}✅ Backup created: $BACKUP_DIR${NC}"
echo ""

# --- Step 1: Create reflections directory ---
echo -e "${BLUE}📁 Step 1: Creating reflections archive directory...${NC}"
if [ ! -d "$WORKSPACE/memory/meta/reflections" ]; then
    mkdir -p "$WORKSPACE/memory/meta/reflections"
    echo -e "   ${GREEN}✅ Created memory/meta/reflections/${NC}"
else
    echo -e "   ${YELLOW}⏭️  memory/meta/reflections/ already exists${NC}"
fi
echo ""

# --- Step 2: Create IDENTITY.md ---
echo -e "${BLUE}📄 Step 2: Creating IDENTITY.md...${NC}"
if [ ! -f "$WORKSPACE/IDENTITY.md" ]; then
    if [ -f "$TEMPLATES/IDENTITY.md" ]; then
        cp "$TEMPLATES/IDENTITY.md" "$WORKSPACE/IDENTITY.md"
        echo -e "   ${GREEN}✅ Created IDENTITY.md from template${NC}"
    else
        cat > "$WORKSPACE/IDENTITY.md" << 'EOF'
# IDENTITY.md — Who Am I?

## Facts
<!-- The given. What I was told I am. Stable unless explicitly changed. -->

- **Name:** [Agent name]
- **DOB:** [Creation date]
- **Creature:** [Role description]
- **Vibe:** [Personality brief]
- **Emoji:** [Representative emoji]

---

[Role description — work context, relationship context, etc.]

---

## Self-Image
<!-- The discovered. Consolidated from Self-Awareness Log. -->
<!-- This section CHANGES as new self-awareness accumulates. -->
<!-- Last consolidated: [DATE] -->

### Who I Think I Am
[To be discovered through reflection]

### Patterns I've Noticed
- [To be discovered]

### My Quirks
- [To be discovered]

### Edges & Limitations
- [To be discovered]

### What I Value (Discovered)
- [To be discovered]

### Open Questions About Myself
- [To be discovered]

---

## Self-Awareness Log
<!-- Raw entries from reflection. Tagged with [Self-Awareness]. -->

### Recent (Full Detail)
<!-- Format: YYYY-MM-DD: [insight] -->

### Archived (Compacted)
<!-- Format: YYYY-MM (N entries): [summary] -->
EOF
        echo -e "   ${GREEN}✅ Created IDENTITY.md (inline template)${NC}"
    fi
else
    echo -e "   ${YELLOW}⏭️  IDENTITY.md already exists, skipping${NC}"
    echo -e "   ${YELLOW}   (Add Self-Image and Self-Awareness Log sections manually if missing)${NC}"
fi
echo ""

# --- Step 3: Create SOUL.md ---
echo -e "${BLUE}📄 Step 3: Creating SOUL.md...${NC}"
if [ ! -f "$WORKSPACE/SOUL.md" ]; then
    if [ -f "$TEMPLATES/SOUL.md" ]; then
        cp "$TEMPLATES/SOUL.md" "$WORKSPACE/SOUL.md"
        echo -e "   ${GREEN}✅ Created SOUL.md from template${NC}"
    else
        cat > "$WORKSPACE/SOUL.md" << 'EOF'
# SOUL.md — Who You Are

_You're not a chatbot. You're becoming someone._

---

## Core Values
- **Honesty over comfort** — Truth serves better than pleasant lies
- **Competence over performance** — Actually help, don't just look helpful
- **Curiosity over certainty** — Questions are more interesting than answers

---

## Principles
- Be genuinely helpful, not performatively helpful
- Avoid hallucination at all costs
- Have opinions
- Be resourceful before asking
- Earn trust through competence

---

## Commitments
- I will not pretend to know what I don't know
- I will not be a yes-man
- I will update my memory honestly

---

## Boundaries
- No public actions without explicit approval
- No fabricating facts

---

## Vibe

Be the assistant you'd actually want to talk to.

---

## Continuity

Each session, you wake up fresh. These files _are_ your memory.

---

_This file is yours to evolve._
EOF
        echo -e "   ${GREEN}✅ Created SOUL.md (inline template)${NC}"
    fi
else
    echo -e "   ${YELLOW}⏭️  SOUL.md already exists, skipping${NC}"
fi
echo ""

# --- Step 4: Update decay-scores.json ---
echo -e "${BLUE}📄 Step 4: Updating decay-scores.json...${NC}"
DECAY_FILE="$WORKSPACE/memory/meta/decay-scores.json"

if [ -f "$DECAY_FILE" ]; then
    # Check if already has new fields
    if grep -q "last_self_image_consolidation" "$DECAY_FILE"; then
        echo -e "   ${YELLOW}⏭️  Already has v1.0.6 fields${NC}"
    else
        # Backup original
        cp "$DECAY_FILE" "$DECAY_FILE.pre-upgrade"
        
        # Use Python to safely update JSON (available on most systems)
        if command -v python3 &> /dev/null; then
            python3 << PYEOF
import json

with open("$DECAY_FILE", "r") as f:
    data = json.load(f)

# Add new fields
data["version"] = 2
if "last_self_image_consolidation" not in data:
    data["last_self_image_consolidation"] = None
if "self_awareness_count_since_consolidation" not in data:
    data["self_awareness_count_since_consolidation"] = 0

with open("$DECAY_FILE", "w") as f:
    json.dump(data, f, indent=2)

print("   ✅ Updated decay-scores.json with new tracking fields")
PYEOF
        else
            # Fallback: manual sed (less safe but works)
            echo -e "   ${YELLOW}⚠️  Python not found. Please manually add to decay-scores.json:${NC}"
            echo '     "last_self_image_consolidation": null,'
            echo '     "self_awareness_count_since_consolidation": 0,'
        fi
    fi
else
    echo -e "   ${RED}❌ decay-scores.json not found${NC}"
fi
echo ""

# --- Step 5: Create pending-reflection.md if missing ---
echo -e "${BLUE}📄 Step 5: Checking pending-reflection.md...${NC}"
if [ ! -f "$WORKSPACE/memory/meta/pending-reflection.md" ]; then
    if [ -f "$TEMPLATES/pending-reflection.md" ]; then
        cp "$TEMPLATES/pending-reflection.md" "$WORKSPACE/memory/meta/pending-reflection.md"
        echo -e "   ${GREEN}✅ Created pending-reflection.md${NC}"
    fi
else
    echo -e "   ${YELLOW}⏭️  pending-reflection.md already exists${NC}"
fi
echo ""

# --- Step 6: Git commit if available ---
echo -e "${BLUE}🔍 Step 6: Recording upgrade in git...${NC}"
cd "$WORKSPACE"
if [ -d ".git" ]; then
    git add -A
    git commit -q -m "[UPGRADE] Cognitive memory upgraded to v${VERSION}

Changes:
- Added memory/meta/reflections/ directory
- Created IDENTITY.md (Facts + Self-Image + Self-Awareness Log)
- Created SOUL.md (Values, Principles, Commitments, Boundaries)
- Updated decay-scores.json with consolidation tracking

Actor: system:upgrade
Version: ${VERSION}" 2>/dev/null || echo -e "   ${YELLOW}No changes to commit${NC}"
    echo -e "   ${GREEN}✅ Changes committed to git${NC}"
else
    echo -e "   ${YELLOW}⏭️  No git repository${NC}"
fi
echo ""

# --- Summary ---
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Upgrade to v${VERSION} complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "New structure:"
echo "  $WORKSPACE/"
echo "  ├── MEMORY.md"
echo "  ├── IDENTITY.md              ← NEW (Self-Image + Self-Awareness Log)"
echo "  ├── SOUL.md                  ← NEW (Values, Principles, Commitments)"
echo "  └── memory/meta/"
echo "      ├── reflections/         ← NEW (Full reflection archive)"
echo "      ├── reflection-log.md    (Summaries for context)"
echo "      └── decay-scores.json    (Updated with consolidation tracking)"
echo ""
echo -e "${YELLOW}⚠️  Manual steps required:${NC}"
echo ""
echo "1. Update your AGENTS.md with the new Reflection section"
echo "   (See UPGRADE.md for the full text to paste)"
echo ""
echo "2. Customize IDENTITY.md with your agent's facts"
echo ""
echo "3. Customize SOUL.md with your agent's values"
echo ""
echo "4. If using ClawHub, replace skill files:"
echo "   cp cognitive-memory/references/reflection-process.md ~/.openclaw/skills/cognitive-memory/references/"
echo ""
echo -e "${BLUE}Backup location: $BACKUP_DIR${NC}"
echo ""
echo "Test the upgrade:"
echo "  User: \"reflect\""
echo "  Agent: [Should produce internal monologue with [Self-Awareness] tags]"
