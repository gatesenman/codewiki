/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        wiki: {
          bg: 'rgb(var(--wiki-bg) / <alpha-value>)',
          sidebar: 'rgb(var(--wiki-sidebar) / <alpha-value>)',
          card: 'rgb(var(--wiki-card) / <alpha-value>)',
          border: 'rgb(var(--wiki-border) / <alpha-value>)',
          text: 'rgb(var(--wiki-text) / <alpha-value>)',
          muted: 'rgb(var(--wiki-muted) / <alpha-value>)',
          accent: 'rgb(var(--wiki-accent) / <alpha-value>)',
          green: 'rgb(var(--wiki-green) / <alpha-value>)',
          purple: 'rgb(var(--wiki-purple) / <alpha-value>)',
          orange: 'rgb(var(--wiki-orange) / <alpha-value>)',
        }
      }
    },
  },
  plugins: [],
}
