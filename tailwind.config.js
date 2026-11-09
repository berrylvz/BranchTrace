/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17212b',
        paper: '#f6f8f7',
        branch: '#24745b',
        ember: '#d97941',
      },
    },
  },
  plugins: [],
}
