/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        editor: {
          bg: '#18181b',          // Main editor background (Zed-like solid dark)
          sidebar: '#1e1e24',     // Sidebar background (slightly lighter)
          active: '#27272a',      // Active selection/hover
          border: '#3f3f46',      // 1px divider lines
          text: '#e4e4e7',        // Standard text
          accent: '#0284c7',      // Professional deep blue accent
          hover: '#27272a',       // Hover states
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
