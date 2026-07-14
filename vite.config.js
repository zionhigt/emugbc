import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // le service worker se met à jour tout seul au prochain chargement
      registerType: 'autoUpdate',
      // inactif pendant les tests (vitest) : rien à générer là
      disable: process.env.VITEST === 'true',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'EMUGBC — Game Boy Color',
        short_name: 'EMUGBC',
        description: 'Émulateur Game Boy Color fait main.',
        lang: 'fr',
        theme_color: '#2583af',
        background_color: '#0b1220',
        display: 'standalone', // plein écran, sans barre de navigateur
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // Vite bloque par défaut les requêtes dont le Host est inconnu (403
  // « Blocked request »). Pour tester via un tunnel, on autorise ses domaines
  // (localtunnel = .loca.lt, cloudflared = .trycloudflare.com). Le « . » de tête
  // couvre tous les sous-domaines.
  preview: { allowedHosts: ['.loca.lt', '.trycloudflare.com'] },
  server: { allowedHosts: ['.loca.lt', '.trycloudflare.com'] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
});
