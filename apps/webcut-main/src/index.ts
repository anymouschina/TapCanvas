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
import WebCutHistoryListTool from './views/tools/history-list/index.vue';
import WebCutSaveProgressTool from './views/tools/save-progress/index.vue';
// 面板 - 编辑器右侧
import WebCutPanel from './views/panel/index.vue'; // 集成所有面板
import WebCutTextPanel from './views/panel/text/index.vue';
import WebCutBasicPanel from './views/panel/basic/index.vue';
import WebCutExportButton from './views/export-button/index.vue';
// 素材库 - 编辑器左侧
import WebCutLibrary from './views/library/index.vue';
// 编辑器 - 高度集成，包含播放器、素材库、管理器、面板等
import WebCutEditor from './views/editor/index.vue';

import AdjustableBox from './components/adjustable-box/index.vue';
import AudioShape from './components/audio-shape/index.vue';
import ContextMenu from './components/context-menu/index.vue';
import ScrollBox from './components/scroll-box/index.vue';
import DraggableHandler from './components/draggable-handler/index.vue';
import RotateInput from './components/rotate-input/index.vue';

export {
    WebCutProvider,
    WebCutPlayerScreen,
    WebCutPlayerButton,
    WebCutPlayer,
    WebCutManager,
    WebCutManagerContainer,
    WebCutManagerScaler,
    WebCutManagerAsideRail,
    WebCutManagerMainSegment,
    WebCutManagerToolBar,
    WebCutVideoSegment,
    WebCutAudioSegment,
    WebCutImageSegment,
    WebCutTextSegment,
    WebCutClearTool,
    WebCutDeleteTool,
    WebCutSplitTool,
    WebCutSplitKeepLeftTool,
    WebCutSplitKeepRightTool,
    WebCutFlipHorizontalTool,
    WebCutConcatTool,
    WebCutHistoryListTool,
    WebCutSaveProgressTool,
    WebCutEditor,
    WebCutSelectAspectRatio,
    WebCutTimeClock,
    WebCutLibrary,
    WebCutPanel,
    WebCutTextPanel,
    WebCutBasicPanel,
    WebCutThemeSwitch,
    WebCutExportButton,
    WebCutLangSwitch,

    AdjustableBox,
    AudioShape,
    ContextMenu,
    ScrollBox,
    DraggableHandler,
    RotateInput,
    WebCutLoading,
};

export {
    useScrollBox,
} from './components/scroll-box';

export {
    useWebCutContext,
    useWebCutPlayer,
    useWebCutData,
    useWebCutThemeColors,
    useWebCutDarkMode,
    useWebCutLoading,
} from './hooks';
export {
    useWebCutManager,
} from './hooks/manager';
export {
    useWebCutLibrary,
} from './hooks/library';
export {
    useWebCutLocalFile,
} from './hooks/local-file';
export {
    useWebCutLocale,
} from './hooks/i18n';

export {
    renderTxt2ImgBitmap,
    createTxt2Img,
    buildTextAsDOM,
    cssToText,
    textToCss,
    measureAudioDuration,
    measureImageSize,
    measureTextSize,
    measureVideoDuration,
    measureVideoSize,
    autoFitRect,
    formatTime,
    mp4ClipToBlob,
    mp4ClipToFile,
    audioClipToFile,
    pcmToWav,
    exportBlobOffscreen,
    exportAsWavBlobOffscreen,
    mp4BlobToWavArrayBuffer,
    mp4BlobToWavBlob,
    mp4ClipToAudioClip,
    mp4ClipToFramesData,
    createImageFromVideoFrame,
    progressiveClipToPCMData,
    downloadOffscreen,
} from './libs';
export {
    base64ToFile,
    blobToBase64DataURL,
    fileToBase64DataURL,
    downloadBlob,
    getFileMd5,
    blobToFile,
} from './libs/file';

export {
    getProject,
    createNewProject,
    addFileToProject,
    removeFileFromProject,
    writeFile,
    readFile,
    addFile,
    getFile,
    getAllFiles,
    moveProjectHistoryTo,
    pushProjectHistory,
    getProjectHistory,
    clearProjectHistory,
    getProjectState,
    updateProjectState,
} from './db';

export {
    type WebCutContext,
    type WebCutHighlightOfText,
    type WebCutSegmentOfText,
    type WebCutRailOfText,
    type WebCutSegment,
    type WebCutRail,
    type WebCutMaterialType,
    type WebCutMaterial,
    type WebCutMaterialMeta,
    type WebCutSource,
    type WebCutSourceData,
    type WebCutProjectHistoryState,
    type WebCutProjectHistoryData,
    type WebCutColors,
} from './types';
