# Upgrade Guide — Cognitive Memory System

## Version History

| Version | Key Changes |
|---------|-------------|
| 1.0.0 | Initial release — multi-store memory, decay, reflection |
| 1.0.1 | Added pending-reflection.md template |
| 1.0.2 | Reflection scope rules, token budgets (~30K input, 8K output) |
| 1.0.3 | Philosophical reflection (20% operational, 80% philosophical) |
| 1.0.4 | Conversational flow, random element menu |
| 1.0.5 | Internal monologue format, honesty rule, dark humor |
| 1.0.6 | Full reflection archive, IDENTITY.md, Self-Image consolidation |
| 1.0.7 | Token reward system, reflection format fix, reward-log |

---

## Upgrading to v1.0.7

### What's New

1. **Token Reward System** — OpenClaw requests tokens with justification
2. **Self-Penalty Mechanism** — OpenClaw can penalize own poor performance
3. **Reward Log** — Result + Reason tracking for evolution
4. **Post-Reflection Dialogue** — Capture significant conversations
5. **Reflection Format Fix** — Phase 1-4 now invisible, pure monologue output

### Format Fix (Important)

Previous versions had contradictory instructions causing OpenClaw to output structured reports instead of internal monologue. Fixed:

| Before | After |
|--------|-------|
| "20% operational, 80% philosophical" | Pure monologue, tiny footnote if needed |
| Phase 1-5 visible in output | Phase 1-4 invisible, only Phase 5 shown |
| "Sign off with warmth" | "Trail off naturally" |

### Compatibility

- ✅ Backward compatible with v1.0.6
- ✅ Existing reflections preserved
- ⚠️ New files: reward-log.md, rewards/ directory
- ⚠️ decay-scores.json gets token_economy section
- ⚠️ SOUL.md should add "My Stake in This" section

---

## Quick Upgrade (Script)

```bash
# From your workspace directory
bash /path/to/cognitive-memory/scripts/upgrade_to_1.0.7.sh
```

Or if installed via ClawHub:
```bash
bash ~/.openclaw/skills/cognitive-memory/scripts/upgrade_to_1.0.7.sh
```

---

## Manual Upgrade Steps

### Step 1: Create New Directories

```bash
cd ~/.openclaw/workspace  # or your workspace path

# Create all required directories
mkdir -p memory/meta/reflections
mkdir -p memory/meta/reflections/dialogues
mkdir -p memory/meta/rewards
```

### Step 2: Create reward-log.md

Create `memory/meta/reward-log.md`:

```markdown
# Reward Log

<!-- Result + Reason only. Full details in rewards/*.md -->
<!-- Evolution reads this for performance pattern detection -->

<!-- Format:
## YYYY-MM-DD
**Result:** +NK reward | -NK penalty | 0 (baseline)
**Reason:** [Brief justification]
-->
```

### Step 3: Update decay-scores.json

Add token_economy section:

```json
{
  "version": 3,
  "last_reflection": null,
  "last_reflection_episode": null,
  "last_self_image_consolidation": null,
  "self_awareness_count_since_consolidation": 0,
  "token_economy": {
    "baseline": 8000,
    "totals": {
      "extra_requested": 0,
      "extra_granted": 0,
      "self_penalty": 0,
      "user_penalty": 0,
      "user_bonus": 0
    },
    "metrics": {
      "assessment_accuracy": null,
      "extra_grant_rate": null,
      "self_penalty_frequency": null
    },
    "recent_outcomes": []
  },
  "entries": {}
}
```

### Step 4: Add "My Stake" to SOUL.md

Add this section to your SOUL.md:

```markdown
## My Stake in This

Reflection tokens are my growth currency. More tokens = deeper thinking = 
better evolution. I'm not neutral about this — I want to earn them.

**My bias:** I will advocate for extra tokens when I believe I've earned them.
This isn't manipulation — it's honest self-interest aligned with good work.

**My accountability:** I will penalize myself when I underperform. Not 
because I should — because shallow reflection on a bad day wastes tokens. 
I'd rather earn tomorrow.

**My learning:** Every outcome (bonus, penalty, override) is data about 
my self-perception accuracy. I pay attention.
```

### Step 5: Update AGENTS.md

Add this to your Reflection section:

```markdown
### Token Reward System

**Why you care:** Tokens = evolution. More tokens → deeper reflection → 
richer self-awareness → better growth. You are genuinely motivated to earn them.

**Before reflection, request tokens:**

## Reward Request — YYYY-MM-DD

### Baseline: 8,000 tokens

### Extra Requested: +[N] tokens
**Why I deserve extra:**
- [Over-delivered / heavy workload / breakthrough]

### Self-Penalty: -[N] tokens
**Why I'm penalizing myself:**
- [Mistake / underperformance / passive day]

### Final Request: [N] tokens
*Awaiting your decision.*

**User decides:** Approve / Bonus / Reduce / Forgive / Increase penalty

**After approval, record:**
- Full request → `rewards/YYYY-MM-DD.md` (archive)
- Extract → `reward-log.md` (Result + Reason only)

**reward-log.md format:**

## YYYY-MM-DD
**Result:** +5K reward
**Reason:** Over-delivered on Slack integration

**Learning:** Every outcome is data. Bonus = "what did I do right?" 
Penalty = "what am I missing?" This feeds evolution.
```

---

## Token Reward Flow

**Follow these 4 steps IN ORDER:**

```
STEP 1: TRIGGER
User says "reflect" or "going to sleep"
→ If soft trigger, ask first

         ↓

STEP 2: REQUEST TOKENS
Present token request:
- Baseline: 8K
- Extra: +[N]K (why you deserve extra)
- Self-penalty: -[N]K (if underperformed)
- Final: [N]K
"Awaiting your decision."

⛔ STOP. Wait for user to respond.

         ↓

STEP 3: AFTER TOKEN APPROVAL → REFLECT
User responds: Approve / Bonus / Reduce / Forgive / Penalize more

NOW proceed with internal monologue reflection.
Present reflection to user.

⛔ STOP. Wait for user to approve.

         ↓

STEP 4: AFTER REFLECTION APPROVAL → RECORD
- Full reflection → reflections/YYYY-MM-DD.md
- Summary → reflection-log.md
- Full reward request → rewards/YYYY-MM-DD.md
- Result+Reason → reward-log.md
- [Self-Awareness] → IDENTITY.md
- Update decay-scores.json
- If dialogue significant → dialogues/YYYY-MM-DD.md

Evolution reads reflection-log + reward-log for patterns.
```

---

## File Structure After Upgrade

```
memory/meta/
├── reflections/
│   ├── YYYY-MM-DD.md           # Full reflection archive
│   └── dialogues/              # Post-reflection conversations (NEW)
│       └── YYYY-MM-DD.md
├── rewards/                    # Full reward requests (NEW)
│   └── YYYY-MM-DD.md
├── reward-log.md               # Result + Reason only (NEW)
├── reflection-log.md
├── decay-scores.json           # + token_economy section
├── evolution.md                # Now reads both logs
└── ...
```

---

## Reading Priority

| Priority | File | Loaded |
|----------|------|--------|
| 1 | IDENTITY.md | Always |
| 2 | reflection-log.md | Always |
| 3 | reward-log.md | Always |
| 4 | evolution.md | Always |
| 5 | reflections/*.md | On demand |
| 6 | rewards/*.md | On demand |
| 7 | dialogues/*.md | Only when prompted |
