module.exports = {
  content: ["./apps/web/index.html", "./apps/web/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f5f0fd",
          100: "#ebe2f8",
          500: "#9662ca",
          600: "#7d3fb3",
          700: "#683494",
        },
      },
    },
  },
  plugins: [],
};
