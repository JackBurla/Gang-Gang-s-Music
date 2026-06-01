/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Fraunces", "Cambria", "Georgia", "serif"],
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        ink: {
          950: "#0b0a0f",
          900: "#100e16",
          800: "#171420",
          700: "#221d2e",
          600: "#2d2740",
          500: "#3b3450",
          300: "#9c93b8",
          200: "#cfc8e2",
          100: "#ece8f7",
        },
        accent: {
          DEFAULT: "#f5a524",
          soft: "#f7c66b",
        },
      },
      boxShadow: {
        glow: "0 18px 60px -22px rgba(245, 165, 36, 0.45)",
      },
    },
  },
  plugins: [],
};
