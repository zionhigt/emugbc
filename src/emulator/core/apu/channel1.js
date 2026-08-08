import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import { Channel, NRegister, NRegister4 } from "./channel";

/**
 * NR10 porte la cadence, le sens et le décalage : les coups de cloche encore en retard
 * étaient dus à l'ANCIEN réglage, et l'unité de sweep ne se réveille que quand on
 * l'interroge. On la fait donc rattraper avant d'écrire, sinon elle rejoue ce retard avec
 * les champs qu'on vient de poser. Même capture que la position de wave et le LFSR.
 */
class NR10 extends NRegister {
    setValue(val) {
        this.parent.captureSweepStep();
        // Le sens est lu APRÈS la purge : le calcul négatif qui arme le drapeau est souvent
        // un coup de cloche en retard, rejoué par cette purge-là — celle de l'écriture qui
        // efface le bit. Lu avant, il serait encore vierge.
        const wasSweepDown = this.parent.isSweepDown;
        super.setValue(val);
        this.parent.onSweepDirectionWritten(wasSweepDown);
    }
}

/**
 * Même artefact que NR10 juste au-dessus, et pour la même raison : le rattrapage paresseux
 * du sweep RÉÉCRIT NR13/NR14, si bien qu'une écriture du CPU qu'il n'a pas précédée se fait
 * recouvrir plus tard par un coup de cloche pourtant antérieur à elle.
 */
class NR13 extends NRegister {
    setValue(val) {
        this.parent.captureSweepStep();
        super.setValue(val);
    }

    /** L'écriture du sweep lui-même : voir `write` de NR14 ci-dessous. */
    write(value) {
        this._buffer[0] = value;
    }
}

/**
 * Le sweep réécrit la fréquence depuis l'intérieur de `frequencyAt` : passer par `setValue`
 * le ferait rentrer dans sa propre boucle de rattrapage. D'où cette porte brute, qui pose
 * l'octet sans rien réveiller.
 */
class NR14 extends NRegister4 {
    write(value) {
        this._buffer[0] = value;
    }
}

export default function(apu) {
    function ChanFactory(start, Parent) {
        class Chan extends Parent {
            constructor() {
                super(...arguments);
                this._sweepFrequency = 0;
                this._sweptTicks  = 0;
                this._sweepTimer = 0;
                this._isSweepArmed = false;
                this._hasSubtractedSinceTrigger = false;
            }

            get sweepTimerPeriod() {
                return this.sweepPace === 0 ? 8 : this.sweepPace;
            }

            get sweepPace() {
                return (this.NR0.getValue() & 0x70) >> 4;
            }

            get sweepShift() {
                return (this.NR0.getValue() & 0x07);
            }

            get isSweepDown() {
                return byte.getFlag(this.NR0.getValue(), 3);
            }

            addReg(offset) {
                if (offset === 0) {
                    this.registers[this.start] = new NR10(this);
                } else if (offset === 3) {
                    this.registers[this.start + offset] = new NR13(this);
                } else if (offset === 4) {
                    this.registers[this.start + offset] = new NR14(this);
                } else {
                    super.addReg(offset);
                }
            }

            isEnabledAt(cycle) {
                this.frequencyAt(cycle);
                return super.isEnabledAt(cycle);
            }

            setFrequency(val) {
                this.NR3.write(val & 0xFF);
                const high = (this.NR4.getValue() & 0xF8) | ((val >> 8) & 0x07)
                this.NR4.write(high);
            }

            frequencyAt(cycle) {
                if (this.apu.sweepTicks(cycle) < this._sweptTicks) {
                    console.warn("Special case");
                    return;
                }
                if (!this._isSweepArmed || !super.isEnabledAt(cycle)) {
                    this._sweptTicks = this.apu.sweepTicks(cycle);
                    return this._sweepFrequency;
                }
                const target = this.apu.sweepTicks(cycle);
                while (this._sweptTicks < target) {
                    this._sweptTicks += 1;
                    this._sweepTimer -= 1;
                    if (this._sweepTimer === 0) {
                        this._sweepTimer = this.sweepTimerPeriod;
                        if (this.sweepPace !== 0) {
                            let n = this.computeN();
                            if (n > 2047) {
                                this._isEnabled = false;
                            } else if(this.sweepShift !== 0) {
                                this._sweepFrequency = n;
                                this.setFrequency(n);
                                n = this.computeN();
                                if (n > 2047) {
                                    this._isEnabled  = false;
                                }
                            }
                        }
                    }
                }
                return this._sweepFrequency;
            }

            /** Purger le retard : avancer l'unité jusqu'à maintenant, sans rien recharger. */
            captureSweepStep() {
                this.frequencyAt(this.apu.totalMachineCycles);
            }

            /**
             * Effacer le bit de sens éteint le canal si un calcul négatif a eu lieu depuis le
             * dernier trigger. Pandocs, `Audio_details.md`, « Obscure Behavior » :
             *
             *   « Clearing the sweep direction bit in NR10 after at least one sweep calculation
             *     has been made using the substraction mode since the last trigger causes the
             *     channel to be immediately disabled. »
             *
             * Le wiki gg8 en donne le pourquoi : « This prevents you from having the sweep lower
             * the frequency then raise the frequency without a trigger inbetween. »
             *
             * On lit ici un FRONT — le bit passe de 1 à 0 — parce que la doc écrit « CLEARING the
             * sweep direction bit ». Lire un ÉTAT (le bit est bas alors que le drapeau est armé)
             * serait strictement équivalent : le drapeau ne s'arme qu'avec le bit levé, donc toute
             * écriture qui le trouve armé vient elle-même de baisser ce bit.
             */
            onSweepDirectionWritten(wasSweepDown) {
                const isDirectionCleared = wasSweepDown && !this.isSweepDown;
                if (isDirectionCleared && this._hasSubtractedSinceTrigger) {
                    this._isEnabled = false;
                }
            }

            computeN() {
                const delta = this._sweepFrequency >> this.sweepShift;
                // « at least one sweep calculation » : TOUT calcul compte, y compris le stérile
                // — décalage nul, ou registre fantôme à 0, où la soustraction ne change rien.
                if (this.isSweepDown) this._hasSubtractedSinceTrigger = true;
                const n = this.isSweepDown ? this._sweepFrequency - delta : this._sweepFrequency + delta;
                return n;
            }

            onTrigger() {
                this._sweepFrequency = this.frequency;
                this._sweptTicks  = this.apu.sweepTicks(this.apu.totalMachineCycles);
                this._sweepTimer = this.sweepTimerPeriod;
                this._isSweepArmed = this.sweepPace !== 0 || this.sweepShift !== 0;
                // « since the last trigger » : la remise à zéro précède le calcul ci-dessous, qui
                // peut donc réarmer aussitôt.
                this._hasSubtractedSinceTrigger = false;
                if (this.sweepShift !== 0) {
                    const n = this.computeN();
                    if (n > 2047) this._isEnabled = false;
                }
            }
        }
    
        return new Chan(apu, start);
    }
    return Channel(0xFF10, ChanFactory);
}