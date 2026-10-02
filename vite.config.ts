import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: Number.parseInt(process.env.PORT || '8080', 10),
    allowedHosts: true,
    hmr: false,
  },
});
