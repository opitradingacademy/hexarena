/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        arena: {
          bg: "#0b0d17",
          surface: "#141726",
          border: "#262b45",
          cyan: "#00f0ff",
          magenta: "#ff2fd0",
          gold: "#ffcf3f",
          purple: "#8b5cf6",
          green: "#39ff9b",
        },
      },
      boxShadow: {
        neonCyan: "0 0 20px rgba(0, 240, 255, 0.35)",
        neonMagenta: "0 0 20px rgba(255, 47, 208, 0.35)",
        neonGold: "0 0 20px rgba(255, 207, 63, 0.35)",
      },
    },
  },
  plugins: [],
};
