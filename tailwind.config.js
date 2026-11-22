/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#25382e',
        paper: '#f7f9f8',
        branch: '#24745b',
        ember: '#96602d',
      },
    },
  },
  plugins: [],
}
