import { defineConfig } from 'vite';

// `base` is the URL prefix the built site is served under. GitHub Pages serves
// project pages at /<repo>/, so all asset paths in the bundle must start with
// /masterzap/ — otherwise /assets/... resolves to the user-site root and 404s.
export default defineConfig({
  base: '/masterzap/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    },
  },
  preview: {
    // Reached through `tailscale serve`, which fronts the loopback port with
    // HTTPS on a *.ts.net name. Vite rejects hostnames it does not know, and
    // the browser needs a secure context for the clipboard and the share sheet.
    allowedHosts: ['.ts.net'],
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'jsdom',
  },
});
