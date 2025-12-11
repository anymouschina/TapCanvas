# Web Components Usage

This guide explains how to use WebCut as Web Components in any modern web application, without requiring Vue.js.

## Installation

### Option 1: NPM

```bash
npm install webcut
```

### Option 2: CDN

```html
<script src="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/index.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/style.css">
```

## Basic Usage

### Import (for NPM)

```javascript
import 'webcut/webcomponents';
import 'webcut/webcomponents/style.css';
```

### HTML Integration

Add the web component to your HTML:

```html
<webcut-editor project-id="my-project"></webcut-editor>
```

### Component List

- **webcut-editor**: Main editor component
- **webcut-provider**: Video/audio/image/text resource provider component
- **webcut-player-screen**: Video/audio playback screen component
- **webcut-player-button**: Playback control button component
- **webcut-manager**: Segment management component
- **webcut-manager-scaler**: Segment scaling component
- **webcut-player**: Video/audio player component
- **webcut-select-aspect-ratio**: Video aspect ratio selection component
- **webcut-library**: Resource library component
- **webcut-video-segment**: Video segment component
- **webcut-audio-segment**: Audio segment component
- **webcut-image-segment**: Image segment component
- **webcut-text-segment**: Text segment component
- **webcut-clear-selected-tool**: Clear selected segment tool component
- **webcut-delete-current-tool**: Delete current segment tool component
- **webcut-split-current-tool**: Split current segment tool component
- **webcut-split-keep-left-tool**: Split and keep left segment tool component
- **webcut-split-keep-right-tool**: Split and keep right segment tool component
- **webcut-panel**: Panel component
- **webcut-text-panel**: Text panel component
- **webcut-basic-panel**: Basic panel component
- **webcut-time-clock**: Time clock component
- **webcut-export-button**: Export button component

## Attributes

### webcut-editor

- **project-id**: Unique identifier for your project (optional)

```html
<webcut-editor project-id="my-project"></webcut-editor>
```

## JavaScript API

You can control the editor programmatically using the JavaScript API:

```javascript
// Get the editor element
const editor = document.querySelector('webcut-editor');

// Wait for the editor to be ready
editor.addEventListener('webcut-ready', async () => {
  // Access the player API
  const player = editor.player;
  
  // Push a video
  await player.push('video', 'https://example.com/video.mp4', {
    autoFitRect: 'contain',
    time: { start: 0, duration: 5000000 } // 5 seconds in nanoseconds
  });
  
  // Playback control
  player.play();
  player.pause();
  player.moveTo(1000); // Move to 1 second
  
  // Export
  const blob = await player.exportBlob();
  player.download('my-export');
});
```

## Events

The Web Components emit events you can listen to:

- **webcut-ready**: Fired when the editor is fully initialized
- **webcut-project-loaded**: Fired when a project is loaded
- **webcut-segment-selected**: Fired when a segment is selected
- **webcut-export-complete**: Fired when export is completed

```javascript
const editor = document.querySelector('webcut-editor');

editor.addEventListener('webcut-ready', () => {
  console.log('Editor is ready!');
});

editor.addEventListener('webcut-export-complete', (event) => {
  console.log('Export completed:', event.detail);
});
```

## Example

You can find complete example code in the examples/webcomponents directory.

Here's a complete example using the Web Components:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WebCut Web Components Example</title>
    <style>
      html, body, #app {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
      }
      #controls {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 1000;
      }
    </style>
    <!-- Using CDN -->
    <script src="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/index.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/style.css">
  </head>
  <body>
    <div id="app">
      <webcut-editor id="editor" project-id="demo-project"></webcut-editor>
    </div>
    <div id="controls">
      <button id="add-video">Add Video</button>
      <button id="export">Export</button>
    </div>
    <script>
      const editor = document.getElementById('editor');
      const addVideoBtn = document.getElementById('add-video');
      const exportBtn = document.getElementById('export');
      
      editor.addEventListener('webcut-ready', () => {
        console.log('Editor is ready');
        
        addVideoBtn.addEventListener('click', async () => {
          try {
            await editor.player.push('video', 'https://example.com/sample.mp4', {
              autoFitRect: 'contain',
              time: { start: 0, duration: 10000000 } // 10 seconds
            });
          } catch (error) {
            console.error('Failed to add video:', error);
          }
        });
        
        exportBtn.addEventListener('click', async () => {
          try {
            await editor.player.exportBlob();
            editor.player.download('my-creation');
          } catch (error) {
            console.error('Export failed:', error);
          }
        });
      });
    </script>
  </body>
</html>
```

## Browser Support

Web Components are supported in all modern browsers:

- Chrome 67+
- Firefox 63+
- Safari 13+
- Edge 79+

For older browsers, you may need to include polyfills.

## Next Steps

- Explore the JavaScript API for more advanced operations
- Integrate with your existing application
- Check the source code in `src/webcomponents.ts` for implementation details