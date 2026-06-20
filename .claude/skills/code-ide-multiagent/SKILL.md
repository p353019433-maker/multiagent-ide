---
name: code-ide-multiagent
description: 自制ide 多 agent 协作编码的统一工作流与红线。当一项编码改动需要多个 agent(纯 API / Claude Code / Codex / Antigravity 外壳)协作时使用——先讨论收敛出统一方案,各 agent 在独立 git worktree 并行实现,对比 diff 后由人审采用其一并落地。触发词:多agent、多智能体、圆桌、round table、并行实现、orchestrate、协作改代码、让 agent 们一起做、agent 协作。
---

# 自制ide 多 Agent 协作工作流

多个 agent 就同一编码任务协作:先讨论出一份统一方案,再各自在隔离 worktree 实现,最后对比、择优、落地。目标是「集思广益 + 可对比 + 可回滚」,而不是一个 agent 闷头改。

## 工作流

### Phase 1 · 讨论收敛(只读,不改码)
1. 收集**启用**的 agent(设置→智能体里 enabled 的)。输入:用户问题。
2. 自由共享讨论:每个 agent 简明发言(≤150 字)、能看到彼此发言、可反驳;最多 N 轮(默认 2)。
3. 一个主持人 agent 汇总成**统一方案**(3-5 条明确、可执行的要点)。输出:`plan` 文本。
   - 🔴 CHECKPOINT:方案先给用户看,确认后才进入实现。

### Phase 2 · 并行实现(各自隔离)
4. 每个参与实现的 agent 建**独立 git worktree**(`<repo>_wt/ma-<tag>-<序号>`),按统一方案改动。
   - 纯 API agent → 走无人值守循环(headless task loop)。
   - 外壳 agent → `claude -p` / `codex exec` / `agy -p`,cwd = 该 worktree。
5. 每个 worktree 跑完后收集 `git diff`。输出:每个 agent 一份 diff。

### Phase 3 · 对比与落地
6. 并排展示各 agent 的 diff 供对比。
7. 🔴 CHECKPOINT:由**人**选定采用哪一份(或要求重做);**不要自动合并**。
8. 采用 = 在该 worktree `git add -A && commit`,再 `squash` 合并进主分支;其余 worktree 清理。

## 失败模式(必须显式处理)
- **reasoning 模型烧光 token、只吐 `<think>` 没有答案** → max_tokens 给足(讨论轮 ≥2500、主持人/整合 ≥8000),输出先剥掉 `<think>`;某 agent 无有效产出 → **跳过它**,不要让空产出污染讨论/对比。
- **多个 agent 同时改同一文件 → 冲突** → 每个 agent 必须在**自己的 worktree**,绝不共享同一工作区直接写。
- **某 CLI 未安装 / 未登录 / 限流(429)** → 跳过该 agent 并在结果里标注,不阻塞其余;**不要重试同一个失败调用**,换路或跳过。
- **采用时 squash 合并有冲突** → 把冲突如实抛给用户,**不要 force**。
- **把整份大 SKILL.md 注入提示 → 爆上下文** → 只注入与当前任务相关的技能,或按需加载其正文。

## 红线 / 不要做(blacklist)
- 🔴 **绝不 `git push` / 开 PR / 合 PR** —— 本项目当前只在本地改(除非用户这一轮明确要求)。
- 🔴 不要让 agent 执行危险命令(`rm -rf`、`dd of=`、force push、`git reset --hard`、`curl … | sh`、`sudo` 等)。
- 不要在没有人审的情况下把改动合并/落地到主工作区。
- 不要让多个 agent 写同一个工作区(必须 worktree 隔离)。
- 不要伪造「所有 agent 都成功」—— 失败的如实标注(error / 无产出)。
- 不要把模型内部 ID 或 API key 写进代码、提交信息或日志。

## 质量门(改完必须过)
- `tsc -p tsconfig.main.json` 与 `tsc -p tsconfig.json` 均 0 错误;
- `npm test` 全绿;新增逻辑配单测;
- 必要时 `vite build` 能过。
