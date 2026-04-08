module.exports = {
  content: [
    "./src/pages/Clientes/**/*.{html,js}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#0d3fd1",
        "primary-container": "#eef2ff",
        "on-primary-container": "#001356",
        secondary: "#212e3e",
        tertiary: "#1ab466",
        background: "#ffffff",
        surface: "#ffffff",
        "on-surface": "#212e3e",
        "on-surface-variant": "#4b5563",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f8fafc",
        "surface-container": "#f1f5f9",
        "surface-container-high": "#e2e8f0",
        outline: "#94a3b8",
        "outline-variant": "#cbd5e1",
        error: "#dc2626",
      },
      borderRadius: {
        DEFAULT: "0.125rem",
        lg: "0.25rem",
        xl: "0.5rem",
        full: "0.75rem",
      },
      fontFamily: {
        inter: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
        headline: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
        body: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
        label: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
        display: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
