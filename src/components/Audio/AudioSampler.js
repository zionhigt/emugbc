// Traduit la sortie numérique du mixeur (apu.sample(cycle), un entier 0-480 par
// canal — voir apu/mixer.test.js) en un flux stéréo flottant prêt pour un
// haut-parleur : rééchantillonnage du domaine des cycles machine vers le taux
// audio, puis passe-haut pour manger la composante continue que le mixeur
// laisse volontairement passer (« le filtre appartiendra au front »).
//
// Pur calcul, sans dépendance au DOM : utilisable aussi bien depuis le worker
// d'émulation que depuis le thread principal.

export const SAMPLE_RATE = 44100;

const MACHINE_FREQUENCE = 1048576; // Hz — même horloge que Machine (core/machine/index.js)
const CYCLES_PER_SAMPLE = MACHINE_FREQUENCE / SAMPLE_RATE;
const MAX_SAMPLE = 480; // 4 voies × 15 × facteur de volume 8 : le plafond du mixeur
// Le coefficient du passe-haut à un pôle : proche de 1, il ne mange que le
// continu et les toutes basses fréquences (quelques Hz), pas la musique.
const DC_BLOCK_R = 0.999;

// Une trame vaut ~739 échantillons (44 100 / 59,7275). Le tampon en tient
// largement deux : `drain` vide à chaque trame, cette marge n'est là que pour
// les tours où le worker enchaîne deux trames avant de rendre la main.
const BUFFER_SAMPLES = 2048;

export default class AudioSampler {
  constructor() {
    // Accumulateur en cycles fractionnaires : jamais remis à zéro, jamais
    // plafonné, comme celui qui cadence les trames au front — pas de dérive.
    this.nextCycle = 0;
    this._prevInLeft = 0;
    this._prevOutLeft = 0;
    this._prevInRight = 0;
    this._prevOutRight = 0;
    // Tampons TYPÉS et réutilisés d'une trame à l'autre. Des tableaux ordinaires
    // faisaient deux `push` par échantillon (44 100 par seconde et par voie, avec
    // le redimensionnement du stockage derrière), puis un `Float32Array.from` par
    // trame qui recopiait le tout en repassant par des nombres boxés.
    this._left = new Float32Array(BUFFER_SAMPLES);
    this._right = new Float32Array(BUFFER_SAMPLES);
    this._count = 0; // échantillons écrits depuis le dernier drain
  }

  // y[n] = x[n] - x[n-1] + R·y[n-1] : le classique DC-blocker à un pôle.
  _highPass(x, prevIn, prevOut) {
    return x - prevIn + DC_BLOCK_R * prevOut;
  }

  /** Recentre 0..480 sur [-1, 1] : l'origine du mixeur, mise à l'échelle audio. */
  _normalize(raw) {
    return raw / (MAX_SAMPLE / 2) - 1;
  }

  /**
   * À appeler à CHAQUE avancée de cycles (machine.subscribeCycleUpdate), pas une
   * fois par trame : apu.sample(cycle) suppose un curseur unique et croissant,
   * partagé avec les lectures du CPU (NR52 notamment, qui fait avancer le sweep
   * du canal 1 — voir channel1.js). Le reconstituer après coup, une fois la
   * trame entière déjà jouée, demanderait des dates que le canal a déjà
   * dépassées. Empile les échantillons dus dans le tampon interne.
   */
  advance(apu, uptoCycle) {
    while (this.nextCycle <= uptoCycle) {
      const raw = apu.sample(Math.floor(this.nextCycle));

      const xLeft = this._normalize(raw.left);
      const outLeft = this._highPass(xLeft, this._prevInLeft, this._prevOutLeft);
      this._prevInLeft = xLeft;
      this._prevOutLeft = outLeft;

      const xRight = this._normalize(raw.right);
      const outRight = this._highPass(xRight, this._prevInRight, this._prevOutRight);
      this._prevInRight = xRight;
      this._prevOutRight = outRight;

      if (this._count === this._left.length) this._grow();
      this._left[this._count] = outLeft;
      this._right[this._count] = outRight;
      this._count++;
      this.nextCycle += CYCLES_PER_SAMPLE;
    }
  }

  // Filet, jamais le cas courant : si une trame s'étire assez pour dépasser la
  // marge, on double plutôt que de perdre des échantillons (un trou s'entendrait).
  _grow() {
    const doubled = this._left.length * 2;
    const left = new Float32Array(doubled);
    const right = new Float32Array(doubled);
    left.set(this._left);
    right.set(this._right);
    this._left = left;
    this._right = right;
  }

  /**
   * Vide le tampon accumulé depuis le dernier drain — à appeler une fois par trame.
   * `slice` rend deux Float32Array neufs, avec leur propre ArrayBuffer : c'est ce
   * qu'il faut, l'appelant les TRANSFÈRE au thread principal (postMessage), donc on
   * ne peut pas lui prêter une vue sur le tampon qu'on continue d'écrire.
   */
  drain() {
    const left = this._left.slice(0, this._count);
    const right = this._right.slice(0, this._count);
    this._count = 0;
    return { left, right };
  }
}
