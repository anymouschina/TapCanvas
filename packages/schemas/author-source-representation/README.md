# 作者来源表示与正向转换关系

本包仅有纯校验与类型声明，没有 API、数据库、文件读取、provider、编译器调用或任务调度。Hono 执行层的作者来源记录、修订受理和回执校验使用同一个 `.mjs` 合同，不依赖 Pro Agent 内核。它不修改历史执行或已生成资产，只校验宿主传入的真实记录。

`verifyServerAuthorSourceRepresentation` 接收服务端已按 owner/flow 权限解析的 durable source record，以及独立读取的 `expected`、实际正向步骤输出和保存的交付文本。函数不能证明输入来自服务器或确实执行过某段代码：认证、来源读取、converter 注册和执行仍是宿主责任。禁止把本函数暴露为客户端提交 raw 文本的验证 API，或把模型自行填写的 expected/receipt 当可信来源。

现有 `WorkflowNodeOutput.evidence` 和 `workflow.node-provenance/v1` 是证据账本；本合同是该账本可追加的作者表示与转换关系，不建立另一个持久层。身份沿 owner、flow/version、source execution、root node/run、leaf、task/session/turn逐项绑定。`representation` 唯一值为 `harness_accepted_pre_host_compilation_candidate`：它表示 harness 已接受的 canonical 候选，不宣称 provider 原始响应。`acceptance.receiptRef` 必须由宿主绑定实际接受事实及 candidate/full-contract hash；hash 本身不是接受证明。

`authorContract.value` 保留完整实际调用合同与 schema，和服务端从原 capsule/冻结请求读取的值、ref、hash 一致。不能用画布静态 schema、客户端 body、当前新版合同或仅 schema hash补全缺失来源。`frozenInputs` 指向原真实输入回执，并核服务端读取的完整事实 hash。JSON hash 对每层对象键递归排序后以 UTF-8 `JSON.stringify` 计算；数组顺序与字符串内容保持原样，文本 hash 仍是 exact UTF-8。这样新回执通过存储 codec 或 JSONB 后仍可验真。历史顺序敏感签名不改写、不重签；历史候选只能凭原候选/来源文本哈希和权限身份作为可追溯原稿交当前合同重新编译，旧合同签名异常保留明确诊断，不能宣称原 acceptance 已通过。

`conversion.steps` 逐步记录实际 converter id/version、输入 hash、输出 hash与冻结输入 hash/ref；它们须匹配服务器注册的顺序和实际 `actualForwardOutputs`。第一步输入是 accepted candidate，后一步输入是前一步实际输出；最后一个输出必须与保存的 delivery exact 相等，同时核独立 `deliveryHash`。三列表显式同时为空表示没有发生宿主转换，必须 candidate exact等于保存的delivery；不虚构identity converter、不从缺失步骤推默认关系。没有逆编译、从 hash 重建正文、语义识别或模型修正。

成功输出不可变 source evidence 和新独立尝试 `attemptBinding`，绑定现有 attempt execution/target/idempotencyKey/requestHash；不生成随机 attempt、不占用或覆盖原执行。该 binding 是追加证据，不替代现有请求幂等认领或权限。源 execution 与本次 execution 相同、目标换为 sibling、任一来源或转换身份不符都只返回 `current_action_not_applied` 的有界路径/代码诊断，不对用户总体任务或 paid 状态下终态结论。

验证（离线、零 provider）：在仓库根目录使用支持 TypeScript 类型擦除的 Node.js 执行 `node --test packages/schemas/author-source-representation/index.test.mts`。同目录执行 `pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node ../../packages/schemas/author-source-representation/index.test.mts`，exit0。覆盖不同 JSON 产物、每个源身份、伪 raw/self-report/hash-only、合同/冻结输入替换、converter及链错配、显式零步、精确交付、独立 attempt 与坏来源诊断。结构测试不能证明语义质量改善。
