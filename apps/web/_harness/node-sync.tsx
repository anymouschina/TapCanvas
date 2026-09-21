import React, { Suspense, lazy, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import { ChatModelControl } from '../src/ui/chat/ChatModelControl'
import { DEFAULT_CHAT_MODEL_SETTINGS } from '../src/ui/chat/useChatModelSettings'
import '../src/ui/chat/ChatModelControl.css'

const TextContent = lazy(() => import('../src/canvas/nodes/taskNode/components/TextContent').then(module => ({ default: module.TextContent })))
function NodeSyncPreview() {
  const editorRef = useRef<HTMLDivElement>(null)
  const [settings, setSettings] = useState(DEFAULT_CHAT_MODEL_SETTINGS)
  const noop = () => undefined
  return <MantineProvider defaultColorScheme="dark">
    <main className="node-sync-preview" style={{ color: '#eee', padding: 64, display: 'flex', gap: 40, alignItems: 'flex-start' }}>
      <section className="node-sync-preview__chapter" style={{ width: 500 }}>
        <h2 className="node-sync-preview__title">第2章学校</h2>
        <div className="node-sync-preview__editor" style={{ height: 400, background: '#161619', padding: 24, borderRadius: 12 }}>
          <Suspense fallback={<p className="node-sync-preview__loading">正在加载正文…</p>}>
            <TextContent html="<h2>第2章学校</h2><p>晨光落在教室的窗台上。走廊传来脚步声，同学们抬起头。</p><p>这段文字用于验证懒加载完成后的首次显示与编辑。</p>"
              selected textEditorFocused={false} textBackgroundTint="transparent" textColor="#eee" textFontSize={16} textFontWeight={400}
              editorRef={editorRef} onFocus={noop} onInput={noop} onBlur={noop} onCompositionStart={noop} onCompositionEnd={noop} />
          </Suspense>
        </div>
      </section>
      <section className="node-sync-preview__chat" style={{ marginTop: 56 }}>
        <ChatModelControl options={[{value:'preview',label:'目录模型（测试）'}]} value="preview" onModelChange={noop}
          placeholder="选择模型" disabled={false} capabilities={{reasoning:true,priority:false,reasoningLevels:['low','medium','high','xhigh']}}
          settings={settings} onSettingsChange={setSettings}/>
      </section>
    </main>
  </MantineProvider>
}
const root = document.getElementById('root')
if (!root) throw new Error('Preview root missing')
createRoot(root).render(<NodeSyncPreview />)
