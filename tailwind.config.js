/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        editor: {
          bg: '#09090b',          // Deep black background
          sidebar: 'rgba(255, 255, 255, 0.03)', // Glassmorphic translucent background
          active: 'rgba(255, 255, 255, 0.08)',
          border: 'rgba(255, 255, 255, 0.1)',   // Thin, subtle border
          text: '#e4e4e7',        // Zinc-200
          accent: '#6366f1',      // Vibrant Indigo accent
          hover: 'rgba(255, 255, 255, 0.05)',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'glow-pulse': 'glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        glow: {
          '0%, 100%': { opacity: 1, filter: 'drop-shadow(0 0 4px rgba(99, 102, 241, 0.4))' },
          '50%': { opacity: 0.5, filter: 'drop-shadow(0 0 2px rgba(99, 102, 241, 0.2))' },
        }
      }
    },
  },
  plugins: [],
};
