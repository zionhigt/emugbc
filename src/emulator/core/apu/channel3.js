import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import { Channel, NRegister, NRegister1, NRegister4 } from "./channel";

class NR30 extends NRegister {
    setValue(val) {
        super.setValue(val);
        if (!this.parent.isDacOn) this.parent._isEnabled = false;
    }
}
class NR31 extends NRegister1 {
    lengthRemaining(val) {
        return this.parent._maxLength - val;
    }
}

/**
 * La période porte le RECHARGEMENT du compteur de fréquence, pas sa valeur en vol : ce
 * qui a déjà défilé l'a été à l'ancienne, et l'échéance déjà armée la garde jusqu'au bout.
 * Seuls les rechargements suivants prennent la nouvelle période.
 */
class NR33 extends NRegister {
    setValue(val) {
        this.parent.catchUpWave();
        return super.setValue(val);
    }
}
/**
 * La corruption de la wave RAM se juge ICI, À L'ENTRÉE, avant tout le reste.
 *
 * Deux choses la consommeraient si on la laissait descendre :
 *   - `catchUpWave` compte l'accès qui tombe exactement à cette date et pousse l'échéance
 *     d'une période au-delà, si bien qu'après lui le canal ne « touche » plus la RAM à
 *     maintenant — mesuré : appliquée après, la règle ne se déclenche jamais ;
 *   - plus bas encore, `NRegister4.setValue` pose `_isEnabled` puis `onTrigger` remet la
 *     position à zéro : l'état dont dépend la corruption n'existe déjà plus.
 */
class NR34 extends NRegister4 {
    setValue(val) {
        if (byte.getFlag(val, 7)) this.parent.corruptWaveRAMOnTrigger();
        this.parent.catchUpWave();
        return super.setValue(val);
    }
}

const OFFSETS = [4, 0, 1, 2];

/**
 * La wave se compte en DEMI-CYCLES MACHINE — 2 T-cycles, la durée du plus court
 * échantillon possible. Une grille en cycles machine entiers ne peut pas porter ce
 * modèle : blargg mesure une distinction de 2 T, structurellement invisible dessus. La
 * lecture du CPU tombe toujours sur un demi-cycle PAIR, donc c'est la parité de la
 * période au trigger qui décide si elle coïncide avec l'accès du canal ou passe à 2 T.
 */
const HALF_CYCLES_PER_MACHINE_CYCLE = 2;

/** Seize octets de wave RAM, deux quartets par octet. */
const WAVE_SAMPLE_COUNT = 32;

/** Première adresse de la wave RAM : elle s'indexe en absolu dans `apu._WaveRAM`. */
const WAVE_RAM_START = 0xFF30;

/**
 * La corruption au trigger travaille par quadruplets ALIGNÉS : quatre octets recopiés en
 * tête, pris à `index & ~3`. C'est la granularité que donne le wiki, pas un choix.
 */
const WAVE_CORRUPTION_BLOCK_SIZE = 4;

/**
 * CONSTANTE CALIBRÉE, PAS DÉRIVÉE. Elle ne se démontre pas à partir du matériel : elle a
 * été trouvée par balayage sur les ROMs blargg — une seule combinaison passante sur 170
 * essayées, puis retrouvée à l'identique sur une seconde ROM au CRC et au chemin de code
 * différents. Elle mêle deux retards qu'on ne sait pas séparer : celui du trigger de la
 * wave sur DMG, et notre convention sur l'instant où une écriture atterrit dans le cycle
 * machine. Ne pas la « corriger » au nom d'une explication matérielle, il n'y en a pas.
 */
const WAVE_TRIGGER_DELAY = 3;

export default function(apu) {
    function ChanFactory(start, Parent) {
        class Chan extends Parent {
            constructor() {
                super(...arguments);
                this._maxLength = 256;
                this._wavePosition = 0;
                // Aucune échéance tant que le canal n'a jamais été déclenché.
                this._nextWaveAccess = null;
            }
            get DAC() {
                return byte.getBit(this.NR0.getValue(), 7);
            }

            get volume() {
                return this.NR2.getValue();
            }

            get outputLevel() {
                return (this.NR2.getValue() >> 5) & 0x03;
            }

            waveByteIndexAt(cycle) {
                return Math.floor(this.waveStep(cycle) / 2);
            }

            /** L'interface parle en cycles machine ; la wave, elle, vit en demi-cycles. */
            toHalfCycles(cycle) {
                return cycle * HALF_CYCLES_PER_MACHINE_CYCLE;
            }

            /**
             * Combien d'accès à la wave RAM se sont produits entre l'échéance mémorisée et
             * cette date, échéance comprise. Un décompte, pas une position : le modulo
             * appartient à l'appelant.
             *
             * Une division suffit là où il faudrait dérouler les échéances une à une,
             * parce que la période ne change jamais sans réancrage : tout ce qui la touche
             * — trigger, écriture de NR33 ou NR34 — passe d'abord par `catchUpWave`.
             */
            waveAccessCountAt(halfCycle) {
                if (this._nextWaveAccess === null) return 0;
                if (halfCycle < this._nextWaveAccess) return 0;
                return 1 + Math.floor((halfCycle - this._nextWaveAccess) / this.period);
            }

            /**
             * Le canal touche la RAM à CHAQUE échantillon — un quartet, pas un octet :
             * « CH3 contains an internal sample index counter… Each increment causes the
             * corresponding nibble to be read from wave RAM » (Pandocs, Audio_details).
             *
             * Et seulement à l'instant EXACT de l'accès : la fenêtre est large d'un
             * demi-cycle. Une largeur de deux échoue sur toutes les combinaisons essayées.
             */
            isAccessingWaveAt(cycle) {
                if (!this.isEnabledAt(cycle)) return false;
                if (this._nextWaveAccess === null) return false;
                const halfCycle = this.toHalfCycles(cycle);
                if (halfCycle < this._nextWaveAccess) return false;
                return (halfCycle - this._nextWaveAccess) % this.period === 0;
            }

            waveStep(cycle) {
                const halfCycle = this.toHalfCycles(cycle);
                const accesses = this.waveAccessCountAt(halfCycle);
                return (this._wavePosition + accesses) % WAVE_SAMPLE_COUNT;
            }

            waveSample(cycle) {
                const position = this.waveStep(cycle);
                // Lecture directe : passer par apu.read ferait retomber le canal sur sa
                // propre porte, et il se lirait 0xFF dès qu'il n'est pas dans sa fenêtre.
                const octet = this.apu._WaveRAM[WAVE_RAM_START + this.waveByteIndexAt(cycle)].getValue();
                return position % 2 === 0 ? octet >> 4 : octet & 0x0F;
            }

            amplitude(cycle) {
                if (!this.isDacOn || !this.isEnabledAt(cycle)) return 0;
                const sample = this.waveSample(cycle);
                return sample >> OFFSETS[this.outputLevel];
            }

            addReg(offset) {
                if (offset === 0) {
                    this.registers[this.start] = new NR30(this);
                } else if (offset === 1) {
                    this.registers[this.start + offset] = new NR31(this);
                } else if (offset === 3) {
                    this.registers[this.start + offset] = new NR33(this);
                } else if (offset === 4) {
                    this.registers[this.start + offset] = new NR34(this);
                } else {
                    super.addReg(offset);
                }
            }

            /**
             * Amener la position jusqu'à maintenant AVEC LA PÉRIODE COURANTE, avant qu'une
             * écriture ne la remplace, puis laisser l'échéance encore armée où elle est.
             *
             * Ce n'est pas un détail : réancrer l'échéance sur la date de l'écriture
             * effacerait la période au trigger, or c'est exactement la variable que la ROM
             * balaye — elle la décrémente d'un pas par itération pour décaler sa première
             * lecture de 2 T-cycles. Effacée, les itérations deviennent indiscernables.
             */
            catchUpWave() {
                if (this._nextWaveAccess === null) return;
                const now = this.toHalfCycles(this.apu.totalMachineCycles);
                const accesses = this.waveAccessCountAt(now);
                this._wavePosition = (this._wavePosition + accesses) % WAVE_SAMPLE_COUNT;
                this._nextWaveAccess += accesses * this.period;
            }

            /**
             * Recopier un octet de wave RAM sur un autre, sans passer par `apu.write` : le
             * canal joue encore à cet instant, l'écriture retomberait sur sa propre porte
             * d'accès et se ferait rediriger vers l'octet courant.
             */
            copyWaveByte(from, to) {
                const octet = this.apu._WaveRAM[WAVE_RAM_START + from].getValue();
                this.apu._WaveRAM[WAVE_RAM_START + to].setValue(octet);
            }

            /**
             * LA CORRUPTION DE LA WAVE RAM AU TRIGGER (DMG).
             *
             * Wiki gbdev, « Obscure Behavior » : « Triggering the wave channel on the DMG
             * while it reads a sample byte will alter the first four bytes of wave RAM. If
             * the channel was reading one of the first four bytes, the only first byte will
             * be rewritten with the byte being read. If the channel was reading one of the
             * later 12 bytes, the first FOUR bytes of wave RAM will be rewritten with the
             * four aligned bytes that the read was from. »
             *
             * Le déclencheur n'est donc pas le trigger seul : il faut que le canal ait été
             * EN TRAIN de lire un octet à cet instant précis — allumé, et dans sa fenêtre
             * d'accès. `isAccessingWaveAt` porte les deux conditions.
             *
             * Le quadruplet source commence toujours à 4 ou plus, la destination s'arrête à
             * 3 : source et destination ne se chevauchent jamais, l'ordre de copie est libre.
             */
            corruptWaveRAMOnTrigger() {
                const now = this.apu.totalMachineCycles;
                if (!this.isAccessingWaveAt(now)) return;

                const index = this.waveByteIndexAt(now);
                if (index < WAVE_CORRUPTION_BLOCK_SIZE) {
                    this.copyWaveByte(index, 0);
                    return;
                }
                const base = index - (index % WAVE_CORRUPTION_BLOCK_SIZE);
                for (let offset = 0; offset < WAVE_CORRUPTION_BLOCK_SIZE; offset++) {
                    this.copyWaveByte(base + offset, offset);
                }
            }

            onTrigger() {
                const now = this.toHalfCycles(this.apu.totalMachineCycles);
                this._wavePosition = 0;
                this._nextWaveAccess = now + this.period + WAVE_TRIGGER_DELAY;
            }
        }
    
        return new Chan(apu, start);
    }
    return Channel(0xFF1A, ChanFactory);
}