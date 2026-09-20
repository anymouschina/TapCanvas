# Seedance 2.5 Task Patterns

## Contents

- [Usage principles](#usage-principles)
- [Basic generation](#basic-generation)
- [Multimodal references](#multimodal-references)
- [Thirty-second and multi-clip video](#thirty-second-and-multi-clip-video)
- [Video editing](#video-editing)
- [Forward and backward extension](#forward-and-backward-extension)
- [First/last frames and multiple keyframes](#firstlast-frames-and-multiple-keyframes)
- [Storyboards and blockouts](#storyboards-and-blockouts)
- [One-click video](#one-click-video)
- [Seamless transitions](#seamless-transitions)
- [Audio and dialogue](#audio-and-dialogue)
- [Characters and performance](#characters-and-performance)
- [Camera language](#camera-language)

## Usage Principles

Read and apply only the section that matches the active task. Treat each template as a compilation scaffold, not a form that must retain every field. Delete every line that adds no useful control.

- Preserve the user’s or platform’s reference tokens exactly. The tokens `@Image 1`, `@Video 1`, and `@Audio 1` below are placeholders only.
- Put configurable aspect ratio, resolution, and generation duration in a separate settings block rather than prompt prose.
- Deliver natural-language production direction, not a mechanical dump of template labels.
- Protect identity, product geometry, prop ownership, geography, and event continuity before decorative style.

## Basic Generation

### Text-to-Video

Compile in this order:

```text
[Generation Goal]
Generate a <type of video>. The central subject is <subject>, and the primary event is <event>.

[Picture and Event]
<Subject> completes <action> in <environment>. The action begins with <initial state>, changes through <decisive beat>, and ends with <visible state>.

[Camera and Light]
Begin with <shot size/angle>. The camera <movement> and settles on <endpoint>. The primary light comes from <physical source and direction>, causing <visible effect>.

[Sound]
Include or preserve <ambience>, <action sound>, <dialogue>, or <music>.

[Continuity and Exclusions]
Keep <locks> consistent. Do not introduce <excluded content>.
```

Default to one primary event and one primary camera move. Split several complex actions into stages or separate shots.

### Image-to-Video

Do not redescribe static information already defined by the image. Add only:

- subject motion and visible endpoint;
- environmental motion;
- camera start, movement, and endpoint;
- light changes and sound;
- identity, product geometry, text, count, or composition that must remain fixed.

```text
@Image 1 defines the opening subject, composition, and environment. Preserve identity, wardrobe/product geometry, subject count, and primary spatial relationships.
Begin naturally from the image. <Subject action>. End state: <visible state>.
Camera: <one move>. Light: <source/change>. Sound: <intent>.
Do not redesign <protected feature> or add <excluded content>.
```

## Multimodal References

### Three-Layer Role Map

Build three layers before writing the event:

1. Asset roles: what each asset contributes and what it must not contribute.
2. Subject profiles: consolidate identity, wardrobe, fixed props, locations, and motion sources when one subject uses several assets.
3. Scene selection: invoke only assets needed in the current scene.

```text
[Characters]
<Character A> corresponds to @Image 1. Use only facial features, hairstyle, and wardrobe; do not use the image background.
<Character B> corresponds to @Image 2. Use only facial features, hairstyle, and wardrobe.
Do not interchange appearance, clothing, position, motion, or dialogue between the two characters.

[Props]
<Prop A> corresponds to @Image 3 and belongs only to <Character A>. Use only structure, material, and color.

[Environment]
<Environment A> references @Image 4. Use only spatial layout, architecture, and light direction; do not use people from the image.

[Motion and Audio]
@Video 1 controls only <Character A>’s motion path and timing. Do not transfer performer identity, wardrobe, environment, logos, or sound.
@Audio 1 controls only <Character B>’s voice and specified dialogue.

[Scene 1]
Use: <Character A>, <Prop A>, <Environment A>, and motion from @Video 1.
Event: <primary event>.
End state: <observable state>.
```

When several views depict one subject, state that explicitly:

```text
@Image 1, @Image 2, and @Image 3 define the front, left, and rear structure of the same <Product A>.
All three images define one product. The entire output contains exactly one <Product A>.
```

Never write “Use all references for style.” Remove every asset that has no role.

## Thirty-Second and Multi-Clip Video

### Staged Video Within 30 Seconds

Give each stage one primary state change and a visible end state:

```text
[Generation Goal]
Generate a <type of video>. The central subject is <subject>, and the primary event is <summary>.

[Stage 1]
Initial state: <characters, props, and environment>.
Primary event: <one change>.
End state: <visible state>.

[Stage 2]
Continue from the previous stage: keep <locks> unchanged.
Primary event: <one change>.
End state: <visible state>.

[Stage 3]
Primary event: <closing change>.
End state: <final visible state>.

[Maintain Throughout]
Keep character identity and count, wardrobe, prop ownership, screen direction, lighting logic, and audio relationships consistent.
```

### Timestamps

Use ranges to allocate event budgets, one exact point for a critical beat, and relative timing for a delay:

```text
0–5 seconds: <event>. End state: <state>.
5–11 seconds: Continue from the previous state. <event>. End state: <state>.
11–18 seconds: <event>. End state: <state>.
At 18 seconds, the foreground object fully covers the frame and triggers the transition.
Three seconds after the button is pressed, the room lights gradually turn off.
```

Check that:

- ranges are consecutive, non-overlapping, and within generation duration;
- one second does not contain several complete actions;
- too little content does not leave unnecessary freedom;
- too much content does not force cuts or omissions;
- timestamps are not presented as frame-accurate edit points.

### Long-Form Production Beyond 30 Seconds

Do not write one direct-generation prompt longer than 30 seconds. Split the production into independently generated clips of no more than 30 seconds, and carry accepted continuity forward:

```text
[Global Production Canon]
Story objective: <goal>.
Character profiles, wardrobe, and fixed props: <canon>.
World, visual, camera, and audio rules: <rules>.

[Clip 1 | Maximum 30 Seconds]
Narrative job: <purpose>.
Opening state: <state>.
Primary event and visible end state: <event/state>.
Camera and sound: <coverage/audio>.

[Clip 2 | Maximum 30 Seconds]
Continuity source: accepted Clip 1 or its observed final boundary frame.
Opening state: <observed pose, props, space, camera phase, motion, and audio phase>.
Primary event and visible end state: <event/state>.

[Remaining Clips]
Repeat the accepted-boundary process. Do not advance continuity from a rejected or merely planned endpoint.
```

Generate and review each clip separately. Preserve a continuity record across accepted clips, and use editing or post-production to assemble the final long-form video.

## Video Editing

### General Edit

```text
[Edit Goal]
Edit @Video 1. Only within <entire clip/time range>, <add/remove/replace/adjust> <object, region, or audio category>.

[Sole Master]
@Video 1 is the sole editing master. It defines characters, environment, action, composition, camera, occlusion, audio, and event order.

[Target Reference]
@Image 1 defines only <attributes of target>. Do not use <irrelevant people, background, or composition>.

[Edit Scope]
Modify only <target>. Keep exactly <count> target object(s) throughout.

[Preserve]
Keep <protected content> from @Video 1 unchanged. Outside the target above, preserve all characters, props, environment, camera, cuts, audio, and event order.
```

### Subject Replacement

Make the replacement inherit every appearance, motion, occlusion, and exit of the original:

```text
Replace only <Original Object> in @Video 1 with <Target Object> defined by @Image 1.
@Image 1 defines only appearance, structure, and material. Do not use its background or composition.
<Target Object> inherits every appearance, action, occlusion, exit, timestamp, path, and speed change of <Original Object>.
Except for this object, keep the source video unchanged.
```

### Background Replacement

```text
Replace only the background outside the subject silhouette in @Video 1 with the environment defined by @Image 1.
@Image 1 defines only space, materials, depth of field, ambient color, and light direction. Do not use people or foreground objects from the image.
Preserve subject identity, face, hair, wardrobe, expression, position, scale, motion, and occlusion relationships.
```

### Audio Edit

Dialogue, language, voice, background music, and sound effects may be edited independently. Name the speaker or sound category, the exact change, and every sound to preserve:

```text
Edit @Video 1. Remove only the original background music. Preserve character dialogue, lip sync, ambience, and action sound effects, and keep all visuals, camera treatment, and edit rhythm unchanged.
```

For a reference-driven voice or sound replacement, let the source video remain the sole timing and picture master:

```text
@Video 1 is the sole editing master. It defines all visuals, speaker timing, lip sync, other voices, ambience, music, sound effects, and event order.
@Audio 1 defines only <speaker or sound category>'s <voice characteristics, accent, delivery, or sound quality>. Do not use unrelated speakers, words, music, ambience, or timing from @Audio 1.

Change only <speaker or sound category> in @Video 1 to match the specified attributes from @Audio 1. Preserve the original dialogue content and speaking times unless the edit goal explicitly changes them. Keep every other visual and audio category from @Video 1 unchanged.
```

For a language-only edit:

```text
Edit @Video 1. Change only <Presenter>'s spoken language to natural American English while preserving the dialogue content and speaking times. Keep all other voices, background music, ambience, sound effects, visuals, camera treatment, and edit rhythm unchanged.
```

## Forward and Backward Extension

### Forward Extension

Observe the actual source ending first. Never substitute the planned ending.

```text
@Video 1 is the source video to extend forward.

The first frame of the extension directly continues the observed last frame of @Video 1. Maintain <subject pose and orientation>, <prop position>, <spatial relationships>, <camera position and composition>, <lighting>, <motion direction>, and <audio phase>.

Then, <new action, event, camera treatment, or audio>.

Maintain character identity and wardrobe, key props, background layout, and axis of action throughout. Keep each subject as one continuous instance; do not duplicate or split subjects, and keep body/object-part counts stable.
```

Additional references may supplement identity, wardrobe, props, or sound but must not override the source boundary frame’s authority over the extension opening.

### Backward Extension

```text
@Video 1 is the source video to extend backward.

Before the source video begins, <preceding action, event, camera treatment, or audio>.

The final frame of the extension naturally reaches the observed first frame of @Video 1: <subject pose and orientation>, <prop position and state>, and <other character positions>. Match the source opening’s background, spatial relationships, camera position, composition, light, and motion direction.

<Characters, props, or effects that belong only after the source begins> must not appear early.
```

A natural boundary is not a promise of pixel identity. Review both sides of the boundary, motion vectors, and audio continuity.

## First/Last Frames and Multiple Keyframes

### First and Last Frames

```text
@Image 1 is the first frame. It defines opening composition, subject position and pose, prop state, environment, and camera direction.
@Image 2 is the last frame. It defines ending composition, subject position and pose, prop state, environment, and camera direction.
@Image 3 defines only <subject identity/wardrobe/geometry>. It must not change either endpoint composition.

Begin from the first-frame state. <One continuous action or event>. Naturally reach the final state defined by @Image 2.
Between endpoints, maintain identity, prop geometry and ownership, environment layout, light direction, and axis of action.
```

Use matching aspect ratios. Define each endpoint separately instead of combining them into “Images 1 and 2 are the first and last frames.”

### Multiple Keyframes

Prefer one independent image per keyframe. Separate anchor images are usually easier to align than several key states combined into one grid.

```text
Use @Image 1 → @Image 2 → @Image 3 → @Image 4 as keyframes in this order.
@Image 1 is the first frame: <state>.
@Image 2 defines the visible end state of Stage 1: <state>.
@Image 3 defines the visible end state of Stage 2: <state>.
@Image 4 is the last frame: <state>.

Pass through these states in order and connect them with continuous action. Maintain <identity, geometry, ownership, geography, light, and axis> throughout.
```

Keyframes control order and anchor states, not every intermediate frame.

## Storyboards and Blockouts

### Multi-Panel Storyboard

Prefer no more than 15 panels, clean line art or simple diagrams, and minimal text labels.

```text
@Image 1 is an <N-panel> storyboard. Read it <left to right, top to bottom>. Use it only for shot order and approximate composition. Do not inherit line-art style, text labels, or placeholder characters.
@Image 2 defines <Character A>’s appearance and wardrobe.
@Image 3 defines <prop/environment> geometry, material, or light.

Shot 1: <shot size, subject action, environment state, and endpoint>.
Shot 2: <shot size, subject action, camera/transition, and endpoint>.
...
Shot N: <closing action and final visible state>.

Final visual treatment: <style>. Audio: <dialogue, ambience, effects, or music>.
```

### Coarse Blockout

A coarse blockout controls the temporal and spatial skeleton: paths, blocking, camera, cuts, light changes, and sound rhythm. Map every geometric object independently.

Use simple geometry with clear spatial relationships and a complete action sequence. Include arms, wings, or other appendages only when their full motion is defined; incomplete appendage motion may produce stiff movement or structural misinterpretation. If source audio matters, state separately whether to inherit dialogue, music, ambience, action sound effects, or only their rhythm.

```text
@Video 1 is a coarse blockout. Use only motion paths, subject blocking, camera position and movement, cuts, light changes, and rhythm. Do not use its gray appearance, materials, or empty environment.
<Geometric Shape A> in @Video 1 corresponds to <Character A>. <Shape B> corresponds to <Prop B>.
@Image 1 defines <Character A>’s appearance and wardrobe.
@Image 2 defines the environment’s space, materials, and light.

Preserve @Video 1’s paths, blocking, camera, and cuts while rendering <final subject and environment>.
```

### Fine Blockout

A fine blockout already has complete geometry. Preserve geometry, action, space, and camera, then re-render appearance.

```text
@Video 1 is a fine blockout. Preserve subject geometry, action, spatial layout, camera position and movement, and cuts. Do not use its gray materials or empty background.
@Image 1 defines subject material, color, and surface detail.
@Image 2 defines environment materials, light, and visual treatment.

Re-render <source geometry> as <final subject/environment>. Keep structure, action, camera, and spatial relationships unchanged.
```

Remove path lines, axes, rig controls, and camera frustums from a fine blockout before submission.

## One-Click Video

```text
[Asset Roles]
@Image 1 supplies the opening environment. @Image 2 supplies the character/product. @Image 3 supplies the ending image.
@Video 1 supplies only edit rhythm, transition treatment, subtitle treatment, graphic packaging, or music style. Do not transfer people, locations, dialogue, or other source audio unless separately assigned.

[Order]
Show assets in <specified order>. Keep <character/product/location relationships> consistent.

[Image Motion]
Apply subtle push, pull, and parallax to environments. Give people only natural micro-motion such as blinking, head turns, breathing, or slight fabric movement. Keep subject geometry, text, and background relationships stable.

[Final Treatment]
Edit rhythm: <rhythm>. Transitions: <method>. Graphics/captions: <treatment>. Color: <treatment>.

[Audio]
<Dialogue, ambience, effects, or music>.
```

State the exact sequence when order matters. If model-led arrangement is acceptable, explicitly allow thematic organization.

## Seamless Transitions

```text
@Video 1 is the before-transition clip. Use its ending subject, action, composition, camera direction, and audio.
@Video 2 is the after-transition clip. Use its opening subject, composition, camera direction, and audio.
Keep the primary people, products, environments, and actions stable inside both source clips.

At the end of @Video 1, <subject/foreground object> triggers the transition through <action>.
The camera <direction and speed change> while <shape/material/light/space> continuously transforms into <corresponding element> at the opening of @Video 2.
The bridge naturally arrives at @Video 2’s opening composition while preserving subject position, camera direction, and motion trend.
Audio transitions smoothly from <before audio> to <after audio>.
```

Useful triggers include dive/reverse motion, character rotation, foreground occlusion, object morph, push/pull, and focus change. State when the trigger fills the frame and what composition appears after it clears.

## Audio and Dialogue

Use natural language by default. When explicit category separation helps, use the official syntax:

| Content | Syntax | Example |
|---|---|---|
| Music | `()` | `(Soft, rhythmic piano plays in the background)` |
| Sound effect | `<>` | `<A bell rings in the distance>` |
| Dialogue | `{}` | `{Welcome back.}` |
| Subtitle | `【】` | `【Chapter One: Departure】` |

For non-English dialogue, state language, regional variety or accent, delivery, speaker, and then the line:

```text
Dialogue language: natural American English. <Character A> says quietly and conversationally: {I thought you weren't coming.}
```

Assign one speaker to each line. When lip sync is critical, reduce head and camera motion, shorten dialogue, and name the speaking time. Never treat a voice reference as proof of voice authorization.

## Characters and Performance

### Realistic Character Description

Write only dimensions that materially improve recognition or performance:

`Age/ethnicity and face type → skin tone and real texture → three or four identifying facial traits → gaze/emotional cue → hairstyle and environmental interaction → wardrobe cut/color/material → build and presence`

Avoid describing every feature so densely that the prompt competes with itself. When an identity image exists, let it control identity and use text only for necessary locks or unseen information.

### Observable Performance

For one emotional transition:

```text
The overall emotion shifts from <starting state> to <ending state>. After <trigger>, the character first shows <immediate visible reaction>. Then the gaze/brows/mouth/breathing/hands gradually <change>. Finally, <restrained or explicit behavior> reveals the target emotion.
```

Use two to four visible or audible cues for one turn. Use event-triggered stages only when emotion changes several times.

For several emotional changes, bind each change to an observed event instead of assigning moods by time alone:

```text
When <Character A> hears or sees <first trigger>, <immediate observable reaction>.
When <second trigger> occurs, <change in gaze, expression, breathing, posture, or voice>.
After confirming <critical information>, the emotion that <Character A> tries to restrain gradually becomes visible through <observable behavior>.
Finally, <final action, expression, or manner of speaking> establishes the ending emotional state.
```

## Camera Language

Common shot sizes and movements can be written directly: extreme wide, wide, medium, close-up, extreme close-up; push in, pull out, pan, lateral move, follow shot, track, truck, orbit, dive, dolly out, tilt up, crane, handheld; low angle, overhead, first-person.

Bind every camera term to:

- the subject it tracks or focuses on;
- its starting position;
- movement direction and speed change;
- the visible frame change;
- its endpoint or transition point.

Explain uncommon terms as `term + target subject + visible change + foreground/background relationship + direction/speed`:

```text
Rack focus: shift focus smoothly from foreground leaves to the person in the background. The leaves gradually blur while the person’s face changes from soft to sharp.
```

For popular techniques, specify the controlling dimensions instead of relying on the term alone:

| Technique | State explicitly |
|---|---|
| One-take shot | Subjects, spaces, and events the continuous camera passes through in order |
| Dolly zoom | Subject size to preserve and whether the background appears to move closer or farther away |
| Aerial view | Viewing height, movement direction, and environmental area to reveal |
| FPV | First-person traversal or flight path, speed, and turns |
| Bullet time | Action to freeze or slow and the camera's orbit direction |
| Handheld camera | Subject being followed and the intended amount of shake |
| Bounce speed ramp | Acceleration, deceleration or rebound point, and final resting state |

Translate visual treatments into visible outcomes:

```text
Shallow depth of field: keep <Subject A>'s eyes and face sharp while background lights become soft circular bokeh.
Tracking shot: move laterally at <Subject A>'s speed, keeping the subject sharp while the background forms horizontal motion blur in the opposite direction.
Golden hour: warm low-angle sunlight enters from behind and camera left, creating long shadows across <environment>.
Natural vignette: darken the four corners gradually while preserving natural brightness and skin tone at the center, with no black border.
Whip-pan transition: at <critical beat>, pan rapidly <direction>; cut when <foreground object> fully covers the frame, then continue at a similar speed in the next scene.
```

Focal length, aperture, and shutter values may supplement direction, but a visible result is usually clearer than a number alone.
