# Seedance 2.5 Quality Diagnosis and Retakes

## Contents

- [Triage the take first](#triage-the-take-first)
- [One-variable rule](#one-variable-rule)
- [Symptoms and first repairs](#symptoms-and-first-repairs)
- [Complex-task checks](#complex-task-checks)
- [Conservative retry template](#conservative-retry-template)
- [Take log](#take-log)

## Triage the Take First

Do not treat every defect as a prompt rewrite. Choose one of five verdicts first.

| Verdict | Use when | Next action |
|---|---|---|
| Keep | The shot’s primary objective succeeded and no defect is fatal | Lock the take and continue production |
| Fix in post | The problem belongs to color, captions, sound mix, trim, or a few unstable head/tail frames | Fix it in post instead of paying for full regeneration |
| Edit, do not regenerate | Composition and timing are correct; only one layer, object, or audio category is wrong; the surface supports edit | Use the take as the sole master and change only the failing layer |
| Re-roll | The prompt is sound and the failure looks like sampling variance | Keep the prompt unchanged and change the seed; stop after two or three repeats of the same defect |
| Rewrite | The same systematic defect appears in at least two takes | Diagnose the mechanism, then change the prompt, mode, reference, or shot decomposition |

Do not chase perfection in secondary decoration after the primary objective succeeds. Exact text, sound mixing, and edit rhythm are usually post-production tasks.

## One-Variable Rule

Change exactly one item per retry:

- one prompt sentence; or
- the seed; or
- the task mode; or
- one reference asset; or
- one generation parameter.

Do not replace assets, rewrite action, change duration, and add a camera move in one attempt. A multi-variable retry teaches nothing even when it succeeds.

Set an attempt budget and a written definition of “good enough” before generation. If the same defect shows no progress by half the budget, change strategy: split the shot, reduce subjects, change mode, remove reference conflict, or move the requirement to live action or post.

## Symptoms and First Repairs

| Symptom | Likely cause | First repair variable |
|---|---|---|
| Face, character, or product drifts | The prompt redescribes reference-defined identity or overloads motion/style | Remove duplicated static description; keep identity or geometry locks |
| Multiple people look alike or swap faces | Characters are not individually named and bound; action, position, or dialogue ownership is ambiguous | Give each character a separate token, profile, position, and dialogue; prohibit swapping |
| Subject count increases or objects duplicate | Multiple views are interpreted as separate subjects; count is not locked | State that every view depicts one subject and lock the output count |
| Prop drifts or changes owner | Prop ownership, position, or stage end state is missing | Record who holds it, where it is, and its state after every stage |
| Motion is ignored | The prompt contains atmosphere but no trigger, change, or consequence | Write initial state → action → visible consequence → end state |
| Action is rushed or omitted | Too many events occupy one time range | Keep one primary state change per stage and allocate more time |
| Camera jumps | Several incompatible moves or no endpoint | Keep one primary move and define start, subject, direction, and endpoint |
| Camera hides the key action | Decorative camera language outranks action legibility | Simplify or delay the move so the camera covers the decisive beat |
| Output feels generic | Empty quality words replace concrete action, material, light, and sound | Replace adjectives with one physical action, one real light source, and one sound cue |
| VFX becomes noisy | The effect has no source, path, interaction, or dissipation state | Define source, material, path, environmental interaction, and endpoint |
| Lip sync or dialogue fails | Speaker is unassigned, line is too long, or head/camera motion is excessive | Bind the speaker, shorten the line, and stabilize head and framing |
| Non-English dialogue uses the wrong language | Language, regional variety, and delivery are not explicit | Restate language, accent or variety, delivery, and speaker before the line |
| Audio reference is ignored | Audio and video compete for timing; audio role is undefined | Let video control picture/motion and audio control tempo/voice only |
| Random captions or irrelevant music | Text and audio boundaries are unclear | Prohibit unwanted captions/music and list the audio categories to preserve |
| Text, logo, or specification breaks | Small text is being redrawn during motion | Keep text static, centered, and protected, or add it in post |
| An edit changes the whole clip | No sole master, scope, or preservation list | Rewrite as sole master + one changed layer + everything else preserved |
| Extension does not connect | The actual boundary frame is unobserved; motion/camera/audio phase is lost | Rewrite from the observed first/last frame and inherit every open vector |
| Extension repeats an old action | Completed beats are not recorded | State that the beat is complete and must not replay; continue from its end state |
| A future event appears early | The current stage contains later information or assets | Remove the later beat and reserve it for the next stage |
| First/last-frame arrival is unstable | Endpoint roles are combined, ratios differ, or the bridge is overloaded | Define endpoints separately, match ratios, and reduce to one continuous action |
| Blockout render drifts | Coarse versus fine blockout is misclassified; inherited dimensions are unclear | Decide motion skeleton versus complete geometry, then separate inheritance from re-rendering |
| Transition looks like a hard cut | No trigger, coverage process, or arrival state | Define occlusion/morph trigger, continuous motion, corresponding element, and audio bridge |

## Complex-Task Checks

### Multi-Reference Conflict

Choose one controlling source for each dimension: identity, wardrobe, geometry, environment, motion, camera, pacing, audio, and style. One asset may own several compatible dimensions, but one dimension must not have two contradictory owners.

Remove any asset that controls nothing. If conflicting assets must remain, state the winner and the sacrificed attribute.

### Edit Failure

Check whether the prompt:

1. declares the source video as the sole editing master;
2. defines one edit target;
3. specifies the time, region, object, or audio category;
4. lists identity, action, composition, camera, occlusion, audio, and event-order preservation;
5. makes a replacement inherit every appearance, motion, occlusion, and exit of the original object.

When the source is correct and only one layer fails, edit again instead of regenerating the entire video.

### Extension Failure

Let accepted footage override the original plan. Record:

- character pose, gaze, and orientation at the boundary;
- prop ownership, position, and state;
- background and spatial relationships;
- camera position, composition, vector, and movement phase;
- unfinished subject and environmental motion;
- dialogue, music, ambience, and sound-effect phase;
- completed events that must not replay.

When repeated extensions visibly drift, re-anchor with canonical identity images, the strongest accepted boundary frame, or an intentional new shot. Do not extend generated output indefinitely.

### Timestamp Failure

Treat timestamps as budgets rather than edit points. Reduce the number of events before adding more second-by-second instructions. Reserve exact timestamps for a critical transition or handoff; use consecutive ranges and visible end states for everything else.

## Conservative Retry Template

```text
<Reference contract>. Preserve <identity/product/environment> exactly.
Complete one visible action only: <specific action and visible consequence>. End state: <observable state>.
Camera: <one primary move and endpoint>.
Light: <physical source and direction>.
Sound: <ambience/effect/dialogue/silence>.
Do not change: <continuity locks>. Do not introduce: <exclusions>.
```

Use this diagnostic output:

```text
Verdict: Keep / Fix in post / Edit / Re-roll / Rewrite
Evidence: one prompt or take detail directly tied to the problem
Root cause: mode, reference conflict, event overload, continuity gap, camera conflict, audio conflict, or sampling variance
Change this time: one variable
Repaired prompt: ...
```

## Take Log

Record one line per attempt:

```text
Take N · changed: <one variable> · seed: <same/new> · verdict: <one of five> · evidence: <one sentence>
```

For a connected project, only accepted footage may update continuity truth and become the next source:

- Accept: record observed start and end states.
- Accept with deviation: update downstream planning from the observed deviation.
- Repair: do not advance until the repaired layer or tail is accepted.
- Reject: do not add the take to continuity truth or use it as an extension source.
