// mammoth 既无内置 d.ts 也没有 @types 包（npm view @types/mammoth → 404），
// 这里只声明我们实际用到的那一个 API（docx → 纯文本）。
//
// 为什么 import 'mammoth' 而不是 'mammoth/mammoth.browser'：
// mammoth 的 package.json `browser` 字段是**部分模块替换**（./lib/unzip.js、./lib/docx/files.js
// → ./browser/*），vite/webpack 打包时自动生效；mammoth.browser.js 是给 <script> 标签用的
// standalone bundle，走 bundler 不该引它。
declare module 'mammoth' {
  export interface ExtractRawTextInput {
    arrayBuffer: ArrayBuffer
  }
  export interface MammothMessage {
    type: string
    message: string
  }
  export interface MammothResult {
    value: string
    messages: MammothMessage[]
  }
  export function extractRawText(input: ExtractRawTextInput): Promise<MammothResult>
  export function convertToHtml(input: ExtractRawTextInput): Promise<MammothResult>
}
