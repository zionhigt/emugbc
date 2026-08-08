// Le lecteur : tourne sur le thread audio dédié du navigateur (AudioWorklet),
// reçoit des paquets stéréo (Float32Array, un par trame émulée) via
// port.postMessage, et les restitue par quanta de 128 échantillons — le rythme
// que l'API Web Audio impose, indépendant de celui auquel les paquets arrivent.
//
// File d'attente simple : un paquet en retard rend du silence plutôt que de
// bloquer. Mieux vaut un trou que d'attendre et faire patiner tout le reste.

class Queue {
  constructor() {
    this.chunks = [];
  }

  push(chunk) {
    this.chunks.push({ data: chunk, i: 0 });
  }

  next() {
    while (this.chunks.length && this.chunks[0].i >= this.chunks[0].data.length) {
      this.chunks.shift();
    }
    if (!this.chunks.length) return 0;
    const chunk = this.chunks[0];
    return chunk.data[chunk.i++];
  }
}

class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Queue();
    this.right = new Queue();
    this.port.onmessage = ({ data }) => {
      this.left.push(data.left);
      this.right.push(data.right);
    };
  }

  process(inputs, outputs) {
    const [outLeft, outRight] = outputs[0];
    for (let i = 0; i < outLeft.length; i++) {
      outLeft[i] = this.left.next();
      outRight[i] = this.right.next();
    }
    return true; // le processeur reste vivant même sans cartouche chargée
  }
}

registerProcessor('pcm-player', PcmPlayerProcessor);
