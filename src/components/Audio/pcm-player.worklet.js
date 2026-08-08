// Le lecteur : tourne sur le thread audio dédié du navigateur (AudioWorklet),
// reçoit des paquets stéréo (Float32Array, un par trame émulée) via
// port.postMessage, et les restitue par quanta de 128 échantillons — le rythme
// que l'API Web Audio impose, indépendant de celui auquel les paquets arrivent.
//
// Les paquets arrivent par postMessage, cadencés par la boucle rAF/setTimeout
// du worker d'émulation : rien ne garantit qu'ils tombent pile à temps (GC,
// onglet occupé, jitter normal). D'où la marge de démarrage ci-dessous.

// ~60 ms d'avance avant de commencer à jouer : assez pour absorber le jitter
// habituel de livraison sans ajouter un décalage perceptible au son du jeu.
const TARGET_LATENCY_SECONDS = 0.06;

class Queue {
  constructor() {
    this.chunks = [];
    this.length = 0; // échantillons encore en attente, tous paquets confondus
  }

  push(chunk) {
    this.chunks.push({ data: chunk, i: 0 });
    this.length += chunk.length;
  }

  next() {
    while (this.chunks.length && this.chunks[0].i >= this.chunks[0].data.length) {
      this.chunks.shift();
    }
    if (!this.chunks.length) return 0;
    const chunk = this.chunks[0];
    this.length--;
    return chunk.data[chunk.i++];
  }
}

class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Queue();
    this.right = new Queue();
    // Tant que primed est faux, on rend du silence en accumulant : une marge
    // se constitue avant le premier son, pour ne pas jouer à flux tendu.
    this._primed = false;
    this._targetLatencySamples = Math.round(TARGET_LATENCY_SECONDS * sampleRate);
    this.port.onmessage = ({ data }) => {
      this.left.push(data.left);
      this.right.push(data.right);
    };
  }

  process(inputs, outputs) {
    const [outLeft, outRight] = outputs[0];

    if (!this._primed) {
      if (this.left.length < this._targetLatencySamples) {
        outLeft.fill(0);
        outRight.fill(0);
        return true;
      }
      this._primed = true;
    }

    for (let i = 0; i < outLeft.length; i++) {
      outLeft[i] = this.left.next();
      outRight[i] = this.right.next();
    }

    // Vidée à sec malgré la marge (accroc réel côté émulation) : on repart en
    // phase d'amorçage plutôt que d'osciller plein/vide et de craquer en boucle.
    if (this.left.length === 0) this._primed = false;

    return true; // le processeur reste vivant même sans cartouche chargée
  }
}

registerProcessor('pcm-player', PcmPlayerProcessor);
