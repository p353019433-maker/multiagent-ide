/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        app: 'var(--app-bg)',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // 语义状态色（直接引最终值）
        status: {
          DEFAULT: 'var(--status-green)',
          strong: 'var(--status-green-strong)',
          surface: 'var(--status-green-surface)',
        },
        warn: {
          DEFAULT: 'var(--warn-fg)',
          soft: 'var(--warn-fg-soft)',
          surface: 'var(--warn-surface)',
          'surface-soft': 'var(--warn-surface-soft)',
        },
        diffadd: { DEFAULT: 'var(--diff-add-fg)', surface: 'var(--diff-add-surface)' },
        diffdel: { DEFAULT: 'var(--diff-del-fg)', surface: 'var(--diff-del-surface)' },
        link: 'var(--link)',
        tool: 'var(--tool)',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        editor: {
          bg: 'hsl(var(--background))',
          sidebar: 'hsl(var(--surface))',
          active: 'hsl(var(--accent))',
          border: 'hsl(var(--border))',
          text: 'hsl(var(--foreground))',
          accent: 'hsl(var(--editor-accent-hsl) / <alpha-value>)', // 品牌"绿色"现在只是状态色（保留 /opacity）
          hover: 'hsl(var(--accent))',
        },
        // surface 明度阶梯（用于"明度层级代替描边"的柔和分组）
        'surface-1': 'hsl(var(--surface-1))',
        'surface-2': 'hsl(var(--surface-2))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',  // 14px：常规卡片
        '2xl': 'calc(var(--radius) + 8px)', // 18px：大卡片 / sheet / 重要 modal
        pill: '9999px', // Wise pill buttons
      },
      boxShadow: {
        // 双层柔影体系，与单层 .shadow-card / .shadow-float 并存
        ambient: 'var(--shadow-ambient)',
        elevated: 'var(--shadow-elevated)',
        overlay: 'var(--shadow-overlay)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        display: ['Wise Sans', 'Inter', 'sans-serif'], // Wise display font
      },
      // IDE 字号规范（不要再用任意值 text-[NNpx]）：
      // text-10 徽标/快捷键提示 · text-11 状态栏/元信息 · text-xs(12px) UI 默认 · text-13 正文/编辑器侧
      fontSize: {
        10: '10px',
        11: '11px',
        13: '13px',
      },
      // 过渡时长 / 缓动：以 CSS 变量为源（见 globals.css 的 :root），组件层
      // 直接用 `duration-fast` `ease-out` 这类工具类，避免散落 inline ms。
      transitionDuration: {
        fastest: 'var(--duration-fastest)',
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
        spring: 'var(--ease-spring)',
      },
    },
  },
  plugins: [],
};
