/**
 * TapCanvas 嵌入宿主桥。
 *
 * 导演台桌面版由 Electron 主进程提供 `window.directorDesktop`（AI 运行、技能、文件、更新、MCP）。
 * 被 TapCanvas Web 以同源 iframe 嵌入时没有 Electron，本脚本改用 postMessage 与父页面通话，
 * 在子文档里安装同名的 `window.directorDesktop`，让导演台自身的 AI 面板直接跑在 TapCanvas 的
 * AI 对话链路上，而不是退回「网页版不可用」的降级态。
 *
 * 必须在导演台模块入口之前执行：导演台在模块初始化时读取 window.directorDesktop。
 *
 * 只提供当前确实存在的能力；桌面专属能力（软件更新、MCP 服务、本机文件目录）不伪装，
 * 相应入口由导演台按能力存在性自行降级。
 */
(function installTapCanvasHostBridge() {
  'use strict';

  // 只有真的被嵌入时才安装；独立打开导演台时保持原生网页版行为。
  if (window.parent === window) return;

  var pending = new Map();
  var seq = 0;
  var eventHandlers = [];
  var toolHandler = null;
  var toolReadySent = false;

  function call(method, args) {
    return new Promise(function (resolve) {
      var id = ++seq;
      pending.set(id, resolve);
      window.parent.postMessage({ __tcDirectorDesk: true, kind: 'call', id: id, method: method, args: args }, window.location.origin);
    });
  }

  function replyTool(id, result) {
    window.parent.postMessage({ __tcDirectorDesk: true, kind: 'toolResult', id: id, result: result }, window.location.origin);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || data.__tcDirectorDesk !== true) return;

    if (data.kind === 'result') {
      var resolve = pending.get(data.id);
      if (!resolve) return;
      pending.delete(data.id);
      resolve(data.error ? { ok: false, error: String(data.error) } : (data.result || { ok: false, error: '宿主返回为空' }));
      return;
    }

    if (data.kind === 'event') {
      for (var i = 0; i < eventHandlers.length; i++) {
        try { eventHandlers[i](data.data); } catch (error) { /* 单个订阅者异常不影响其它订阅者 */ }
      }
      return;
    }

    if (data.kind === 'tool') {
      var call = data.data || {};
      if (!toolHandler) { replyTool(call.id, { ok: false, error: '导演台工具执行器尚未就绪' }); return; }
      Promise.resolve()
        .then(function () { return toolHandler(call.name, call.args || {}); })
        .then(function (result) { replyTool(call.id, result); })
        .catch(function (error) { replyTool(call.id, { ok: false, error: String((error && error.message) || error) }); });
    }
  });

  window.directorDesktop = {
    profiles: function () { return call('profiles'); },
    configure: function (data) { return call('configure', data); },
    test: function (id) { return call('test', id); },
    conversation: function () { return call('conversation'); },
    newConversation: function () { return call('newConversation'); },
    run: function (data) { return call('run', data); },
    stop: function () { return call('stop'); },
    skills: function (data) { return call('skills', data); },
    copyText: function (text) { return call('copyText', text); },
    // 导出交付：TapCanvas 侧把成片上传并落到画布节点，而不是写本机目录。
    files: function (action, data) { return call('files', { action: action, data: data }); },
    // 交付方式的展示文案由宿主决定，避免嵌到画布后仍写「默认导出目录」。
    exportLabel: '添加到画布 · 自动上传',
    exportHelp: '上传到 TapCanvas 资产并生成一个视频节点，接在导演台节点右侧。',
    onEvent: function (callback) {
      eventHandlers.push(callback);
      return function () {
        var index = eventHandlers.indexOf(callback);
        if (index >= 0) eventHandlers.splice(index, 1);
      };
    },
    onTool: function (callback) {
      toolHandler = callback;
      if (!toolReadySent) {
        toolReadySent = true;
        window.parent.postMessage({ __tcDirectorDesk: true, kind: 'toolsReady' }, window.location.origin);
      }
      return function () { if (toolHandler === callback) toolHandler = null; };
    },
  };
})();
