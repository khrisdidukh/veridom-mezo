import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works on GitHub Pages under /veridom-mezo/
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 900 },
});
