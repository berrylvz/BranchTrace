/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#24352e',
        paper: '#f6f8f7',
        branch: '#216e57',
        progress: '#5479a8',
        ember: '#b45309',
      },
    },
  },
  plugins: [],
}
