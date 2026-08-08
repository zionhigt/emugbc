import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages sert le site sous /emugbc/ (nom du repo) : c'est la racine de
// l'artefact `dist`, donc « dist » n'apparaît jamais dans l'URL. Même valeur
// partout (dev, build, preview) pour que le scope PWA reste cohérent.
// `base` propage à import.meta.env.BASE_URL (→ basename du router), aux assets,
// au service worker et à %BASE_URL% dans index.html.
const base = '/emugbc/';

// GitHub Pages est un hébergement statique sans fallback SPA : une URL inconnue
// (accès direct ou refresh sur /emulator) renvoie un 404. On copie index.html
// en 404.html pour que Pages serve le SPA sur n'importe quelle route.
function spa404Fallback() {
  let outDir;
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const index = path.join(outDir, 'index.html');
      if (fs.existsSync(index)) fs.copyFileSync(index, path.join(outDir, '404.html'));
    },
  };
}

export default defineConfig(() => ({
  base,
  plugins: [
    react(),
    spa404Fallback(),
    VitePWA({
      // le service worker se met à jour tout seul au prochain chargement
      registerType: 'autoUpdate',
      // L'enregistrement est fait À LA MAIN dans main.jsx, via
      // `virtual:pwa-register`. Le script que le plugin injecterait ici ne
      // fait QUE `navigator.serviceWorker.register` : il ne recharge pas la
      // page quand un nouveau service worker prend le contrôle, alors que
      // `autoUpdate` le fait basculer sous la page en cours. Voir main.jsx.
      injectRegister: null,
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
        display: 'fullscreen', // plein écran, sans barre de navigateur
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
