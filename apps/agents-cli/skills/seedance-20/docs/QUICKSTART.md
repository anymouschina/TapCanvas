# Seedance 2.0 Skill OS — Quickstart

> Version 6.6.0 · A 5-minute path from install to your first directed prompt.
> Full documentation: [README](../README.md).

## What this is

Seedance 2.0 Skill OS is an agent skill that directs Seedance 2.0 like a filmmaker instead of stacking adjectives. Its one rule: **direct the model, don't micro-manage the frame.** You describe what a scene is *doing*; the skill compiles that intent into a production-ready prompt.

## 1. Install (about 5 minutes)

Install this repository as **one** root skill named `seedance-20`; its sub-skills and references load by relative path.

**Codex (has a one-command installer):**

```bash
python scripts/install_codex_skill.py --force
```

This copies the repo to `~/.codex/skills/seedance-20` (or `$CODEX_HOME/skills/seedance-20`). Restart Codex, then call `$seedance-20`.

**Install from GitHub (if your client supports repo-URL install):**

```text
https://github.com/Emily2040/seedance-2.0
```

**Manual copy (any other client):** copy this folder into your client's skills directory, keeping the name `seedance-20`. Common targets — verify in your own client, these are not a support guarantee — are in the [Install table of the README](../README.md#install): e.g. Claude Code `.claude/skills/`, Cursor `.cursor/skills/`, GitHub Copilot `.github/skills/`, Windsurf `.windsurf/skills/`.

> Security first: only install into agent clients you trust. Read [SECURITY.md](../SECURITY.md) before using this skill inside a third-party or unfamiliar agent.

## 2. Pick the skill for your situation

| You have… | Load first |
|---|---|
| a vague idea | `seedance-interview` |
| a clear scene | `seedance-prompt` |
| a multi-clip story | `seedance-sequence` |
| an accepted clip to continue | `seedance-continuation` |
| a bad or blocked result | `seedance-troubleshoot` |
| a character, brand, celebrity, or real person | `seedance-copyright` |

## 3. Direct before you write — four questions

1. **What is the scene doing?** A turn, a reveal, a feeling, a demonstration?
2. **How does the camera say it?** Wide for isolation, close for a face, a push-in for a realization.
3. **What does light do?** Time of day, hard vs soft, warm vs cool — in service of the intent.
4. **What does sound do?** Near-silence, one ambient detail, or a line of dialogue.

## 4. One example

**Decorated (weak):**

```
epic cinematic shot of a woman reading a letter, emotional, beautiful lighting, 4K
```

**Directed (strong):**

```
Medium close-up, eye-level; she lowers the letter and her hands go still as a slow push-in arrives; soft window light keeps her face plain; near-silence with one chair scrape.
```

## 5. Two rules that save takes

- **Keep reference tags exactly as written** — `@Image1`, `@Video1`, `@Audio1`, `@图片1`, `@视频1`. Never translate or reformat them.
- **Don't ask for the whole story in one generation.** Generate Clip 01, observe how it *actually* ended, then write Clip 02 from that real ending (`seedance-continuation`).

## 6. Safety

- **Content safety:** if your idea uses a protected character, celebrity, brand, logo, song, or a real person's face or voice, don't hide it in another language — rewrite it into an original, licensed, or post-production equivalent with `seedance-copyright`.
- **Agent safety:** this package makes **no network calls and ships no telemetry**; its scripts are deterministic and offline. Never paste API keys, account cookies, or private footage into an agent you don't trust. See [SECURITY.md](../SECURITY.md).

## 7. Go deeper

- `references/directing-engine.md` — read the scene, choose one intention (33 worked genre examples).
- `references/capability-map.md` — design into model strengths and around known limits.
- `references/api-workflow.md` — API, providers, pricing, model IDs (source-dated).
- `references/examples-by-mode.md` — T2V, I2V, V2V, R2V, FLF2V, edit, and extend examples.

---

Other languages: [中文](QUICKSTART.zh.md) · [日本語](QUICKSTART.ja.md) · [한국어](QUICKSTART.ko.md) · [Español](QUICKSTART.es.md) · [Русский](QUICKSTART.ru.md)
