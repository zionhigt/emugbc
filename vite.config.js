import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages sert le site sous /emugbc/ (nom du repo). En dev/test on reste
// à la racine. `base` propage automatiquement à import.meta.env.BASE_URL,
// aux assets, au service worker et à %BASE_URL% dans index.html.
const base = '/emugbc/dist/';

export default defineConfig(({ command }) => ({
  base: "./", //command === 'build' ? base : '/',
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
        start_url: base,
        scope: base,
        icons: [
          // src relatifs : résolus par rapport au manifest (→ /emugbc/icon-*.png)
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  preview: { allowedHosts: ['.loca.lt', '.trycloudflare.com'] },
  server: { allowedHosts: ['.loca.lt', '.trycloudflare.com'] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
}));
