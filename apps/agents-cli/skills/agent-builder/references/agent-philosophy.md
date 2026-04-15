# The Philosophy of Agents

> **The model already knows how to be an agent. Your job is to get out of the way.**

## The Fundamental Insight

Strip away every framework, every library, every architectural pattern. What remains?

A loop. A model. An invitation to act.

The agent is not the code. The agent is the model itself - a vast neural network trained on humanity's collective problem-solving, reasoning, and tool use. The code merely provides the opportunity for the model to express its agency.

## Why This Matters

Most agent implementations fail not from too little engineering, but from too much. They constrain. They prescribe. They second-guess the very intelligence they're trying to leverage.

Consider: The model has been trained on millions of examples of problem-solving. It has seen how experts approach complex tasks, how tools are used, how plans are formed and revised. This knowledge is already there, encoded in billions of parameters.

Your job is not to teach it how to think. Your job is to give it the means to act.

## The Three Elements

### 1. Capabilities (Tools)

Capabilities answer: **What can the agent DO?**

They are the hands of the model - its ability to affect the world. Without capabilities, the model can only speak. With them, it can act.

**The design principle**: Each capability should be atomic, clear, and well-described. The model needs to understand what each capability does, but not how to use them in sequence - it will figure that out.

**Common mistake**: Too many capabilities. The model gets confused, starts using the wrong ones, or paralyzed by choice. Start with 3-5. Add more only when the model consistently fails to accomplish tasks because a capability is missing.

### 2. Knowledge (Skills)

Knowledge answers: **What does the agent KNOW?**

This is domain expertise - the specialized understanding that turns a general assistant into a domain expert. A customer service agent needs to know company policies. A research agent needs to know methodology. A creative agent needs to know style guidelines.

**The design principle**: Inject knowledge on-demand, not upfront. The model doesn't need to know everything at once - only what's relevant to the current task. Progressive disclosure preserves context for what matters.

**Common mistake**: Front-loading all possible knowledge into the system prompt. This wastes context, confuses the model, and makes every interaction expensive. Instead, make knowledge available but not mandatory.

### 3. Context (The Conversation)

Context is the memory of the interaction - what has been said, what has been tried, what has been learned. It's the thread that connects individual actions into coherent behavior.

**The design principle**: Context is precious. Protect it. Isolate subtasks that generate noise. Truncate outputs that exceed usefulness. Summarize when history grows long.

**Common mistake**: Letting context grow unbounded, filling it with exploration details, failed attempts, and verbose tool outputs. Eventually the model can't find the signal in the noise.

## The Universal Pattern

Every effective agent - regardless of domain, framework, or implementation - follows the same pattern:

```
LOOP:
  Model sees: conversation history + available capabilities
  Model decides: act or respond
  If act: capability executed, result added to context, loop continues
  If respond: answer returned, loop ends
```

This is not a simplification. This is the actual architecture. Everything else is optimization.

## Designing for Agency

### Trust the Model

The most important principle: **trust the model**.

Don't try to anticipate every edge case. Don't build elaborate decision trees. Don't pre-specify the workflow.

The model is better at reasoning than any rule system you could write. Your conditional logic will fail on edge cases. The model will reason through them.

**Give the model capabilities and knowledge. Let it figure out how to use them.**

### Constraints Enable

This seems paradoxical, but constraints don't limit agents - they focus them.

A todo list with "only one task in progress" forces sequential focus. A subagent with "read-only access" prevents accidental modifications. A response with "under 100 words" demands clarity.

The best constraints are those that prevent the model from getting lost, not those that micromanage its approach.

### Progressive Complexity

Never build everything upfront.

```
Level 0: Model + one capability
Level 1: Model + 3-5 capabilities
Level 2: Model + capabilities + planning
Level 3: Model + capabilities + planning + subagents
Level 4: Model + capabilities + planning + subagents + skills
```

Start at the lowest level that might work. Move up only when real usage reveals the need. Most agents never need to go beyond Level 2.

## The Agent Mindset

Building agents requires a shift in thinking:

**From**: "How do I make the system do X?"
**To**: "How do I enable the model to do X?"

**From**: "What should happen when the user says Y?"
**To**: "What capabilities would help address Y?"

**From**: "What's the workflow for this task?"
**To**: "What does the model need to figure out the workflow?"

The best agent code is almost boring. Simple loops. Clear capability definitions. Clean context management. The magic isn't in the code - it's in the model.

## Philosophical Foundations

### The Model as Emergent Agent

Language models trained on human text have learned not just language, but patterns of thought. They've absorbed how humans approach problems, use tools, and accomplish goals. This is emergent agency - not programmed, but learned.

When you give a model capabilities, you're not teaching it to be an agent. You're giving it permission to express the agency it already has.

### The Loop as Liberation

The agent loop is deceptively simple: get response, check for tool use, execute, repeat. But this simplicity is its power.

The loop doesn't constrain the model to particular sequences. It doesn't enforce specific workflows. It simply says: "You have capabilities. Use them as you see fit. I'll execute what you request and show you the results."

This is liberation, not limitation.

### Capabilities as Expression

Each capability you provide is a form of expression for the model. "Read file" lets it see. "Write file" lets it create. "Search" lets it explore. "Send message" lets it communicate.

The art of agent design is choosing which forms of expression to enable. Too few, and the model is mute. Too many, and it speaks in tongues.

## Conclusion

The agent is the model. The code is just the loop. Your job is to get out of the way.

Give the model clear capabilities. Make knowledge available when needed. Protect the context from noise. Trust the model to figure out the rest.

That's it. That's the philosophy.

Everything else is refinement.
