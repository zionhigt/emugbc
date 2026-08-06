import byte from "../../lib/byte";
import { Channel, NRegister } from "./channel";

/**
 * Les diviseurs du wiki — 8, 16, 32, 48, 64, 80, 96, 112 — rapportés au cycle machine,
 * soit le quart de chacun. Le code 0 vaut la moitié du code 1, seule irrégularité du lot.
 */
const DIVISORS = [2, 4, 8, 12, 16, 20, 24, 28];

const LONG_LENGTH = 32767;
const SHORT_LENGTH = 127;

/**
 * Le LFSR n'est simulé qu'ICI, une fois par mode au chargement du module : XOR des deux
 * bits de queue, décalage à droite, résultat réinjecté par le haut, et la sortie est le
 * bit 0 INVERSÉ. La graine est celle que pose le trigger, quinze bits à 1.
 *
 * En mode court, le registre reste large de quinze bits — le résultat du XOR est
 * simplement écrit AUSSI en bit 6 après le décalage. Seule la SORTIE reboucle au bout de
 * 127 crans ; l'état complet, lui, ne revient jamais à sa graine. D'où une table de 127
 * entrées engendrée par un registre de 15 bits, et non par un registre de 7.
 */
const buildSequence = (isShort, length) => {
    const sequence = new Uint8Array(length);
    let lfsr = 0x7FFF;
    for (let step = 0; step < length; step++) {
        sequence[step] = (~lfsr) & 1;
        const feedback = (lfsr & 1) ^ ((lfsr >> 1) & 1);
        lfsr = (lfsr >> 1) | (feedback << 14);
        if (isShort) {
            lfsr = (lfsr & 0x7FBF) | (feedback << 6);
        }
    }
    return sequence;
};

const LONG_SEQUENCE = buildSequence(false, LONG_LENGTH);
const SHORT_SEQUENCE = buildSequence(true, SHORT_LENGTH);

/**
 * NR43 porte la période : ce qui s'est déjà décalé l'a été à l'ANCIENNE, et un réglage
 * posé après coup ne doit pas le recompter. Même capture que la position de wave.
 */
class NR43 extends NRegister {
    setValue(val) {
        this.parent.captureLfsrStep();
        super.setValue(val);
    }
}

export default function(apu) {
    function ChanFactory(start, Parent) {
        class Chan extends Parent {
            constructor() {
                super(...arguments);
                this._lastLfsrStep = 0;
                this._lastLfsrAt = 0;
            }

            get clockShift() {
                return (this.NR3.getValue() & 0xF0) >> 4;
            }

            get clockDivider() {
                return this.NR3.getValue() & 0x07;
            }

            get isShortLfsr() {
                return byte.getFlag(this.NR3.getValue(), 3);
            }

            /** Pas de fréquence ici : la formule mère 2048 - frequency ne veut rien dire. */
            get period() {
                return DIVISORS[this.clockDivider] << this.clockShift;
            }

            get lfsrSequence() {
                return this.isShortLfsr ? SHORT_SEQUENCE : LONG_SEQUENCE;
            }

            /** Un compteur de décalages, pas une position : le modulo appartient à la table. */
            lfsrStep(cycle) {
                return this._lastLfsrStep + Math.floor(
                    (cycle - this._lastLfsrAt) / this.period
                );
            }

            lfsrOutput(cycle) {
                const sequence = this.lfsrSequence;
                return sequence[this.lfsrStep(cycle) % sequence.length];
            }

            amplitude(cycle) {
                if (!this.isDacOn || !this.isEnabledAt(cycle)) return 0;
                return this.lfsrOutput(cycle) * this.volumeAt(cycle);
            }

            captureLfsrStep() {
                const now = this.apu.totalMachineCycles;
                this._lastLfsrStep = this.lfsrStep(now);
                this._lastLfsrAt = now;
            }

            onTrigger() {
                this._lastLfsrStep = 0;
                this._lastLfsrAt = this.apu.totalMachineCycles;
            }

            addReg(offset) {
                if (offset === 3) {
                    this.registers[this.start + offset] = new NR43(this);
                } else {
                    super.addReg(offset);
                }
            }
        }

        return new Chan(apu, start);
    }
    return Channel(0xFF1F, ChanFactory);
}
