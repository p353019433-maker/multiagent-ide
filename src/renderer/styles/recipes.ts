/**
 * 共享 className "recipes"（受 shadcn/ui CVA 思路启发，但保持纯字符串）
 *
 * 项目内同类控件原本在 AgentsTab、SettingsWorkbench、RolesSettings 三处各自
 * 维护一份 className 常量，且彼此规则不一致（圆角、高度、焦点色都不一样）。
 * 这个模块把"输入控件"先收口到一处，新增视觉规则只需要改这里一处。
 *
 * 命名口径：每个 recipe 是一段完整可直接喷到 className 的字符串，组件
 * 仍可以用模板字符串拼接额外修饰。
 *
 * 未来：按钮 / SECTION_HEADER / SETTING_ROW 等 recipes 会逐步搬入，本提交
 * 先把改动面收敛在输入控件，避免一次提交里同时改变太多视觉。
 */

/**
 * 通用输入控件（input / select / textarea 单行版）。
 *
 * 视觉口径：
 *  - 高度 h-9（比旧的 h-8 更宽松，更柔和）
 *  - 圆角 rounded-md（8px，输入框不宜过圆，否则显廉价）
 *  - 边框使用 border-strong（中性细描边）
 *  - 焦点使用 ring + 弱化描边色变（更柔，避免硬黑边框跳变）
 *  - 过渡时长走 duration-fast token，避免散落 inline ms
 */
export const FIELD =
  'h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground outline-none transition-colors duration-fast ease-out focus:border-foreground/30 focus:ring-2 focus:ring-foreground/5 disabled:opacity-50';
