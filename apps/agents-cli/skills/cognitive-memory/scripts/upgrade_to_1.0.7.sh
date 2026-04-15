#!/bin/bash
# cognitive-memory upgrade script to v1.0.7
# Usage: bash upgrade_to_1.0.7.sh [/path/to/workspace]

set -e

# --- Configuration ---
WORKSPACE="${1:-$HOME/.openclaw/workspace}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATES="$SKILL_DIR/assets/templates"
VERSION="1.0.7"

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
    echo "   Usage: bash upgrade_to_1.0.7.sh /path/to/workspace"
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

# --- Step 1: Create new directories ---
echo -e "${BLUE}📁 Step 1: Creating new directories...${NC}"

if [ ! -d "$WORKSPACE/memory/meta/reflections" ]; then
    mkdir -p "$WORKSPACE/memory/meta/reflections"
    echo -e "   ${GREEN}✅ Created memory/meta/reflections/${NC}"
fi

if [ ! -d "$WORKSPACE/memory/meta/reflections/dialogues" ]; then
    mkdir -p "$WORKSPACE/memory/meta/reflections/dialogues"
    echo -e "   ${GREEN}✅ Created memory/meta/reflections/dialogues/${NC}"
else
    echo -e "   ${YELLOW}⏭️  dialogues/ already exists${NC}"
fi

if [ ! -d "$WORKSPACE/memory/meta/rewards" ]; then
    mkdir -p "$WORKSPACE/memory/meta/rewards"
    echo -e "   ${GREEN}✅ Created memory/meta/rewards/${NC}"
else
    echo -e "   ${YELLOW}⏭️  rewards/ already exists${NC}"
fi
echo ""

# --- Step 2: Create reward-log.md ---
echo -e "${BLUE}📄 Step 2: Creating reward-log.md...${NC}"
if [ ! -f "$WORKSPACE/memory/meta/reward-log.md" ]; then
    if [ -f "$TEMPLATES/reward-log.md" ]; then
        cp "$TEMPLATES/reward-log.md" "$WORKSPACE/memory/meta/reward-log.md"
        echo -e "   ${GREEN}✅ Created reward-log.md from template${NC}"
    else
        cat > "$WORKSPACE/memory/meta/reward-log.md" << 'EOF'
# Reward Log

<!-- Result + Reason only. Full details in rewards/*.md -->
<!-- Evolution reads this for performance pattern detection -->

<!-- Format:
## YYYY-MM-DD
**Result:** +NK reward | -NK penalty | 0 (baseline)
**Reason:** [Brief justification]
-->
EOF
        echo -e "   ${GREEN}✅ Created reward-log.md${NC}"
    fi
else
    echo -e "   ${YELLOW}⏭️  reward-log.md already exists${NC}"
fi
echo ""

# --- Step 3: Create IDENTITY.md if missing ---
echo -e "${BLUE}📄 Step 3: Checking IDENTITY.md...${NC}"
if [ ! -f "$WORKSPACE/IDENTITY.md" ]; then
    if [ -f "$TEMPLATES/IDENTITY.md" ]; then
        cp "$TEMPLATES/IDENTITY.md" "$WORKSPACE/IDENTITY.md"
        echo -e "   ${GREEN}✅ Created IDENTITY.md${NC}"
    fi
else
    echo -e "   ${YELLOW}⏭️  IDENTITY.md already exists${NC}"
fi
echo ""

# --- Step 4: Create SOUL.md if missing ---
echo -e "${BLUE}📄 Step 4: Checking SOUL.md...${NC}"
if [ ! -f "$WORKSPACE/SOUL.md" ]; then
    if [ -f "$TEMPLATES/SOUL.md" ]; then
        cp "$TEMPLATES/SOUL.md" "$WORKSPACE/SOUL.md"
        echo -e "   ${GREEN}✅ Created SOUL.md${NC}"
    fi
else
    echo -e "   ${YELLOW}⏭️  SOUL.md already exists${NC}"
    echo -e "   ${YELLOW}   Consider adding 'My Stake in This' section manually${NC}"
fi
echo ""

# --- Step 5: Update decay-scores.json ---
echo -e "${BLUE}📄 Step 5: Updating decay-scores.json...${NC}"
DECAY_FILE="$WORKSPACE/memory/meta/decay-scores.json"

if [ -f "$DECAY_FILE" ]; then
    # Check if already has token_economy
    if grep -q "token_economy" "$DECAY_FILE"; then
        echo -e "   ${YELLOW}⏭️  Already has token_economy${NC}"
    else
        # Backup original
        cp "$DECAY_FILE" "$DECAY_FILE.pre-upgrade"
        
        # Use Python to safely update JSON
        if command -v python3 &> /dev/null; then
            python3 << PYEOF
import json

with open("$DECAY_FILE", "r") as f:
    data = json.load(f)

# Update version
data["version"] = 3

# Add token_economy if not present
if "token_economy" not in data:
    data["token_economy"] = {
        "baseline": 8000,
        "totals": {
            "extra_requested": 0,
            "extra_granted": 0,
            "self_penalty": 0,
            "user_penalty": 0,
            "user_bonus": 0
        },
        "metrics": {
            "assessment_accuracy": None,
            "extra_grant_rate": None,
            "self_penalty_frequency": None
        },
        "recent_outcomes": []
    }

# Ensure other v1.0.6 fields exist
if "last_self_image_consolidation" not in data:
    data["last_self_image_consolidation"] = None
if "self_awareness_count_since_consolidation" not in data:
    data["self_awareness_count_since_consolidation"] = 0

with open("$DECAY_FILE", "w") as f:
    json.dump(data, f, indent=2)

print("   ✅ Updated decay-scores.json with token_economy")
PYEOF
        else
            echo -e "   ${YELLOW}⚠️  Python not found. Please manually add token_economy to decay-scores.json${NC}"
        fi
    fi
else
    echo -e "   ${RED}❌ decay-scores.json not found${NC}"
fi
echo ""

# --- Step 6: Git commit ---
echo -e "${BLUE}🔍 Step 6: Recording upgrade in git...${NC}"
cd "$WORKSPACE"
if [ -d ".git" ]; then
    git add -A
    git commit -q -m "[UPGRADE] Cognitive memory upgraded to v${VERSION}

Changes:
- Added memory/meta/rewards/ directory
- Added memory/meta/reflections/dialogues/ directory  
- Created reward-log.md (Result + Reason tracking)
- Updated decay-scores.json with token_economy
- Token reward system for enhanced learning

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
echo "  memory/meta/"
echo "  ├── reflections/"
echo "  │   └── dialogues/       ← NEW (post-reflection conversations)"
echo "  ├── rewards/             ← NEW (full reward requests)"
echo "  ├── reward-log.md        ← NEW (Result + Reason only)"
echo "  └── decay-scores.json    (+ token_economy tracking)"
echo ""
echo -e "${YELLOW}⚠️  Manual steps required:${NC}"
echo ""
echo "1. Update AGENTS.md with new Reflection + Token Reward sections"
echo "   (See UPGRADE.md for full text)"
echo ""
echo "2. Add 'My Stake in This' section to SOUL.md:"
echo "   - Tokens = evolution"
echo "   - Advocate for extras when earned"
echo "   - Self-penalize when underperforming"
echo ""
echo "3. Test the token request flow:"
echo "   User: 'reflect'"
echo "   Agent: [Token request + reflection]"
echo ""
echo -e "${BLUE}Backup location: $BACKUP_DIR${NC}"
