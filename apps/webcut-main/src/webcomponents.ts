// 全局
import WebCutProvider from './views/provider/index.vue';
import WebCutLangSwitch from './views/lang-switch/index.vue';
import WebCutThemeSwitch from './views/theme-switch/index.vue';
import WebCutLoading from './views/loading/index.vue';
// 播放器
import WebCutPlayer from './views/player/index.vue';
import WebCutPlayerScreen from './views/player/screen.vue';
import WebCutPlayerButton from './views/player/button.vue';
import WebCutSelectAspectRatio from './views/select-aspect-ratio/index.vue';
import WebCutTimeClock from './views/time-clock/index.vue';
// 管理器
import WebCutManager from './views/manager/index.vue'; // 集成所有管理器组件
import WebCutManagerContainer from './views/manager/container/index.vue';
import WebCutManagerScaler from './views/manager/scaler/index.vue';
import WebCutManagerAsideRail from './views/manager/aside/index.vue';
import WebCutManagerMainSegment from './views/manager/main/index.vue';
import WebCutManagerToolBar from './views/manager/tool-bar/index.vue';
// 管理器-素材
import WebCutVideoSegment from './views/manager/segments/video.vue';
import WebCutAudioSegment from './views/manager/segments/audio.vue';
import WebCutImageSegment from './views/manager/segments/image.vue';
import WebCutTextSegment from './views/manager/segments/text.vue';
// 管理器-工具
import WebCutClearTool from './views/tools/clear/index.vue';
import WebCutDeleteTool from './views/tools/delete/index.vue';
import WebCutSplitTool from './views/tools/split/index.vue';
import WebCutSplitKeepLeftTool from './views/tools/split-keep-left/index.vue';
import WebCutSplitKeepRightTool from './views/tools/split-keep-right/index.vue';
import WebCutFlipHorizontalTool from './views/tools/flip-h/index.vue';
import WebCutConcatTool from './views/tools/concat/index.vue';
// 面板 - 编辑器右侧
import WebCutPanel from './views/panel/index.vue'; // 集成所有面板
import WebCutTextPanel from './views/panel/text/index.vue';
import WebCutBasicPanel from './views/panel/basic/index.vue';
import WebCutExportButton from './views/export-button/index.vue';
// 素材库 - 编辑器左侧
import WebCutLibrary from './views/library/index.vue';
// 编辑器 - 高度集成，包含播放器、素材库、管理器、面板等
import WebCutEditor from './views/editor/index.vue';

import { defineCustomElement } from 'vue';

customElements.define('webcut-editor', defineCustomElement(WebCutEditor, { shadowRoot: false }));
customElements.define('webcut-provider', defineCustomElement(WebCutProvider, { shadowRoot: false }));
customElements.define('webcut-player-screen', defineCustomElement(WebCutPlayerScreen, { shadowRoot: false }));
customElements.define('webcut-player-button', defineCustomElement(WebCutPlayerButton, { shadowRoot: false }));
customElements.define('webcut-manager', defineCustomElement(WebCutManager, { shadowRoot: false }));
customElements.define('webcut-manager-scaler', defineCustomElement(WebCutManagerScaler, { shadowRoot: false }));
customElements.define('webcut-player', defineCustomElement(WebCutPlayer, { shadowRoot: false }));
customElements.define('webcut-select-aspect-ratio', defineCustomElement(WebCutSelectAspectRatio, { shadowRoot: false }));
customElements.define('webcut-library', defineCustomElement(WebCutLibrary, { shadowRoot: false }));
customElements.define('webcut-video-segment', defineCustomElement(WebCutVideoSegment, { shadowRoot: false }));
customElements.define('webcut-audio-segment', defineCustomElement(WebCutAudioSegment, { shadowRoot: false }));
customElements.define('webcut-image-segment', defineCustomElement(WebCutImageSegment, { shadowRoot: false }));
customElements.define('webcut-text-segment', defineCustomElement(WebCutTextSegment, { shadowRoot: false }));
customElements.define('webcut-clear-tool', defineCustomElement(WebCutClearTool, { shadowRoot: false }));
customElements.define('webcut-delete-tool', defineCustomElement(WebCutDeleteTool, { shadowRoot: false }));
customElements.define('webcut-split-tool', defineCustomElement(WebCutSplitTool, { shadowRoot: false }));
customElements.define('webcut-split-keep-left-tool', defineCustomElement(WebCutSplitKeepLeftTool, { shadowRoot: false }));
customElements.define('webcut-split-keep-right-tool', defineCustomElement(WebCutSplitKeepRightTool, { shadowRoot: false }));
customElements.define('webcut-flip-horizontal-tool', defineCustomElement(WebCutFlipHorizontalTool, { shadowRoot: false }));
customElements.define('webcut-concat-tool', defineCustomElement(WebCutConcatTool, { shadowRoot: false }));
customElements.define('webcut-panel', defineCustomElement(WebCutPanel, { shadowRoot: false }));
customElements.define('webcut-text-panel', defineCustomElement(WebCutTextPanel, { shadowRoot: false }));
customElements.define('webcut-basic-panel', defineCustomElement(WebCutBasicPanel, { shadowRoot: false }));
customElements.define('webcut-time-clock', defineCustomElement(WebCutTimeClock, { shadowRoot: false }));
customElements.define('webcut-export-button', defineCustomElement(WebCutExportButton, { shadowRoot: false }));
customElements.define('webcut-lang-switch', defineCustomElement(WebCutLangSwitch, { shadowRoot: false }));
customElements.define('webcut-theme-switch', defineCustomElement(WebCutThemeSwitch, { shadowRoot: false }));
customElements.define('webcut-manager-aside-rail', defineCustomElement(WebCutManagerAsideRail, { shadowRoot: false }));
customElements.define('webcut-manager-main-segment', defineCustomElement(WebCutManagerMainSegment, { shadowRoot: false }));
customElements.define('webcut-manager-tool-bar', defineCustomElement(WebCutManagerToolBar, { shadowRoot: false }));
customElements.define('webcut-manager-container', defineCustomElement(WebCutManagerContainer, { shadowRoot: false }));
customElements.define('webcut-loading', defineCustomElement(WebCutLoading, { shadowRoot: false }));