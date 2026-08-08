// L'enregistrement du service worker, isolé ici pour deux raisons : il ne
// concerne que le vrai navigateur (jamais les tests), et il porte un piège qui
// mérite ses lignes.
//
// LE PIÈGE. `registerType: 'autoUpdate'` (vite.config.js) produit un service
// worker en `skipWaiting` + `clientsClaim` : à la première visite après un
// déploiement, le nouveau service worker prend le contrôle de la page DÉJÀ
// OUVERTE, et `cleanupOutdatedCaches` efface l'ancien cache au passage. La
// page, elle, continue de tourner avec les URL de l'ancien build.
//
// Tant que tout le code vit dans le bundle d'entrée, c'est inoffensif : il est
// déjà chargé. Mais le worker d'émulation est un morceau à part, demandé
// SEULEMENT à l'insertion de la cartouche — donc parfois après la bascule.
// Son nom porte un hash de contenu, et l'ancien fichier n'existe plus côté
// serveur : `new Worker(...)` reçoit un 404, et la partie ne démarre pas.
//
// `virtual:pwa-register` referme le trou : en mode auto, il recharge la page
// quand le nouveau service worker s'active, si bien qu'elle repart sur les URL
// du build qui la sert. Le script minimal que le plugin injecte par défaut ne
// le fait PAS — d'où `injectRegister: null` et cet appel explicite.
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return; // pas de service worker en dev

  // Import dynamique : le module virtuel n'existe qu'une fois le plugin passé,
  // et le laisser en import statique ferait échouer la résolution ailleurs
  // (tests, outillage) alors que rien là-bas n'a de service worker.
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {}); // pas de PWA disponible : l'app reste une page normale
}
