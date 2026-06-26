# 项目宪章 · Project Charter

> 这是本仓库的长期方向文档。所有参与开发的 agent / 贡献者都应先读它，并以它为统一基准。
> 当不同 agent 的判断（尤其是安全口径、是否加确认、是否放开自动化）发生冲突时，**以本文件为准**。
> 若要改变威胁模型或自动化边界，先更新本文档，再改代码。
>
> 一句话定位：**这是一个本地优先、面向个人开发者的 AI 代码编辑器**，目标是好用、自动、聪明，
> 不是一个多租户 SaaS、远程开发平台或不可信插件宿主。安全性按**本机单用户环境**裁剪。

---

## 1. 最终形态（我们要做成什么）

一个对标 Cursor / Codex / Antigravity 的桌面 AI IDE，但面向**本地个人开发者**：

- 强大的 **Agent 编程**：能自主读写代码、跑命令、检索代码库、编排多个子任务，并**自我验证**结果。
- **多供应商 LLM**：优先支持 OpenAI-compatible API，同时支持 Anthropic，并通过 provider preset 兼容本地模型、国际模型和国产模型。
- 体验向主流 IDE 看齐：内联补全、语义/混合检索、代码导航、diff/检查点、Artifacts 等。
- **本地优先**：配置、会话、索引、Agent 工作区默认都留在本机，不依赖云端账户或托管服务。
- **可个性化**：模型、endpoint、规则、审批模式和本地工具链都应通过本地配置或 profile 管理，而不是写死进项目身份。

## 2. 核心原则与优先级

当需要取舍时，按这个顺序：

1. **实用性 Practicality** — 真能解决个人开发者的实际编程问题，开箱即用，不绕路。
2. **自动化 Automation** — 能自动完成的就不要让人点；默认朝“自动跑通”设计，而不是默认保守。
3. **智能化 Intelligence** — 充分利用模型能力（自我验证、自我修复、上下文检索、编排）。
4. **性能 Performance** — 大项目不卡死（重活进 worker、增量、缓存）。
5. **整洁 / 可维护** — 测试、类型、结构债。重要，但排在体验之后。

> 企业合规、多租户隔离、强不可信插件模型不在当前优先级列表里；见第 3 节。

## 3. 安全口径（统一标准）

### 3.1 威胁模型（我们防什么）

**单用户 / 本地 / 用户自己的机器。** 主要防两类问题：

- **模型或 Agent 误操作造成的不可逆或对外破坏**：删库、`git push --force`、误开 PR/Release、格式化磁盘、把工作区外的东西改坏。
- **程序 bug 写坏用户数据/配置**。

**明确不面向的场景**：

- 多租户/SaaS 隔离、远程多人共用、不可信第三方插件宿主、供应链安全平台。
- 把本应用部署成公网服务或开放给不可信用户使用。
- 默认不信任本机文件、本机命令、用户自己配置的 provider。

这不是放弃安全，而是避免把个人本地 IDE 误做成企业级沙箱产品。

### 3.2 保留的护栏（防手滑 / 防 bug）

- 危险 shell 命令拦截：`rm -rf`、`dd of=`、`mkfs`、fork bomb、`git push --force`、`git reset --hard`、`git clean -f` 等（见 `src/shared/command-policy.ts`）。
- **对外 / 不可逆**操作默认要人确认或留给手动：`git push`、所有 `github_*` 写操作、PR/Release、分支合并到基线。
- 工作区路径围栏：Agent 不在“已授权工作区”之外乱写（`assertAllowedPath` 等）。把它当成“防手滑越界”，不是强安全沙箱。
- API Key 和 GitHub token 用 Electron `safeStorage` 加密存储；普通 UI 配置不承诺加密。
- Web 抓取需要 SSRF 防护，拒绝 localhost、私网、保留地址和危险 redirect。

### 3.3 不要做的过度加固（除非项目方向明确改变）

- ❌ 不要把它做成强隔离沙箱 / seccomp / 容器化执行 / 远程多租户系统。
- ❌ 不要按不可信前端、不可信插件、不可信用户的假设收紧 IPC、store、命令，到影响正常本地使用。
- ❌ 不要为纯理论攻击面增加大量确认弹窗、打断自动化、或默认拒绝。
- ❌ 不要把某个开发者的本地模型、端口、CLI、Agent 规则写进通用项目说明。

### 3.4 默认取舍

- 拿不准时，**选“能自动跑通”的那条**；只把**不可逆 / 对外**的留给人确认。
- 新功能**默认支持自动化**，而不是默认保守。
- 后台/无人值守的 Agent：允许读、写工作区、跑安全命令、做本地 git；只挡对外写、分支合并、高危命令（见 `src/renderer/task-engine/headlessTaskRunner.ts` 的策略）。

## 4. Agent 自治与自动化期望

- 编排（orchestrate）必须名副其实：子 Agent 要真有工具、能在隔离 worktree 里干活、并尽量自我验证（改完跑 lint/tsc，有错自己修一轮）。
- 优先做“少打扰人”的设计：能自动检测、重试、自愈的，不要弹窗问。
- 失败要可观测、可恢复（检查点、清晰的错误、可重试），但不要因为怕失败就不自动化。

## 5. 个性化边界

项目只提供能力，不携带单个开发者的工作流身份。

- 通用能力入仓库：provider schema、审批模式、Agent 工具、索引、FIM、Git/GitHub、Web 抓取、UI。
- 示例 preset 入仓库：OpenAI-compatible、Anthropic、Gemini、Ollama、DeepSeek 等中性模板。
- 个人偏好不入仓库：真实 endpoint、端口、API Key、本地 CLI 名称、私有 prompt、个人 Agent 角色、工作区规则。
- 推荐用 `*.local.*`、`.local/`、`AGENTS.md` 或工作区规则文件承载本地偏好，并通过 `.gitignore` 排除。

详见 `docs/PERSONALIZATION.md`。

## 6. 工程不变量（改动必须守住）

- **架构**：Electron 三进程（main / preload / renderer），IPC 经 `ipcMain.handle`；renderer 不直接碰 Node。保留 `contextIsolation`、preload 白名单。
- **质量门**：提交前 `npm test` 全绿、`tsc -p tsconfig.main.json` 与 `tsc -p tsconfig.json` 均 0 错误。新增逻辑配单测。
- **不泄密**：不要把 API Key、私有 endpoint、密钥、个人模型内部 ID 写进仓库、提交信息、代码注释或日志。
- **依赖克制**：能不加重依赖就不加；打包相关（native / wasm / asar）改动要能在打包后验证，验证不了就别贸然合。
- **分支/PR**：在指定 feature 分支开发，提交信息清晰；未经维护者同意不开/不合 PR。

## 7. 范围

**做**：Agent 编程、多供应商、检索（符号/AST/向量/BM25/混合/重排）、内联补全/FIM、代码导航、diff/检查点、Artifacts、多会话/worktree 编排、性能（worker 索引）。

**暂缓 / 不追**：

- **MCP**：工作量大，暂缓。
- **强隔离沙箱**：与本定位冲突，不做。
- **VS Code 插件生态 / extension host**：不追；要等价能力时优先走 **LSP / DAP** 标准协议，而不是重写成插件宿主。

## 8. 怎么改这份宪章

- 这是活文档。要调整方向（比如更激进地放开自动 push / 开 PR，或反过来收紧某处），先改这里并对齐，再改代码。
- 具体的大决策（为什么这么做、放弃了什么）记录在提交信息或 ADR 里；本文件只保留长期生效的原则。

---

_附：当前能力快照见 `README.md`；安全策略实现见 `src/shared/command-policy.ts`、`src/main/ipc.ts`、`src/renderer/task-engine/headlessTaskRunner.ts`、`src/renderer/task-engine/toolExecutor.ts`。_
