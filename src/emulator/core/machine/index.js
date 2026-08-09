import MemoryBuilder from "../memory/index.js";
import Timer from "../timer/index.js";
import PPU, { Fetcher } from "../ppu/index.js"
import CGBPPU from "../ppu/cgb.js"
import CgbSystem from "../cgb/index.js"
import APU from "../apu/index.js"
import Joypad from "../joypad/index.js"
import { DMG, CGB, AUTO, isPreference } from "../models.js"

const MACHINE_FREQUENCE = 1048576; // Hz
const MACHINE_FRAMES_PER_SECONDES = 59.7275;
const DEFAULT_BUDGET = Number.parseInt(MACHINE_FREQUENCE / MACHINE_FRAMES_PER_SECONDES);

/** Le CPU s'arrête 2050 cycles machine (8200 dots) après une bascule de régime. */
const STOP_PAUSE = 2050;

export default function(memory, cpu, decoder, clock, serial) {
    class Machine {
        /**
         * `modelPreference` arrive par le CONSTRUCTEUR et non par l'usine, pour
         * la même raison que la classe de Fetcher du PPU : deux appelants passent
         * déjà un sixième argument à l'usine, qu'elle ignore — y glisser la
         * préférence lui aurait fait recevoir un timer.
         *
         * Le défaut est DMG et non AUTO : tant qu'il n'existe pas de PPU CGB, une
         * cartouche marquée 0x80 n'a rien à gagner à démarrer en CGB, et onze des
         * ROMs blargg des fixtures portent justement ce drapeau.
         */
        constructor(modelPreference = DMG) {
            if (!isPreference(modelPreference)) {
                throw new Error(`Machine : préférence de modèle inconnue « ${modelPreference} »`);
            }
            this._modelPreference = modelPreference;
            this._model = null; // résolu à l'insertion de la cartouche
            // Assume that, decoder.cpu == cpu
            this.cpu = cpu;
            this._memory = memory;
            this.decoder = decoder;
            this.clock = clock;
            this.interruptsAcc = 1;
            this.clock.onTick(this.handleTick.bind(this));
            this.totalCycles = 0;
            // Le temps du monde, compté en DEMIS de cycle machine (voir le getter
            // `systemCycles`) : en double régime, un cycle CPU n'en vaut qu'un.
            this._systemHalfCycles = 0;
            // Le régime en cours. Il vit ICI et pas sur KEY1 : il est consulté à
            // chaque cycle payé, alors que le registre n'est lu que quelques
            // fois par partie.
            this._doubleSpeed = false;
            this._observersCyclesUpdate = [];
            // Un PPU provisoire, le temps qu'une cartouche arrive : en 'auto' le
            // modèle n'est pas encore connu. plugCartridge le reconstruira avec le
            // bon, exactement comme il refait le timer.
            this.initPPU(modelPreference === CGB ? CGB : DMG);
            this.initCgbSystem(modelPreference === CGB ? CGB : DMG);
            this.apu = new (APU(this));
            this.joypad = new (Joypad())
            this.subscribeCycleUpdate(function() {
                this.ppu.check();
                this.apu.check();
            }.bind(this));

            this._tickObservers = [];

            this.cpu.onCyclesUpdate(this.cyclesUpdate.bind(this));
            this.cpu.onStop(this.onStop.bind(this));

            this._timerTickCallback = this.onTimer.bind(this);
            this.initTimer();
        }

        cyclesUpdate(cpu, n) {
            if (n.type === "add") {
                this.totalCycles += n.value;
                // Le temps du MONDE avance en même temps, mais pas forcément du
                // même pas : en double régime, un cycle du processeur ne vaut
                // qu'un demi cycle système. On compte en demis pour ne rien
                // perdre en route — un demi cycle machine, c'est deux dots, et
                // le PPU les compte.
                this._systemHalfCycles += n.value * (this.doubleSpeed ? 1 : 2);
            }
            this.emitCyclesUpdate();
        }

        /**
         * LES DEUX MONTRES.
         *
         * `totalCycles` est celle du PROCESSEUR : c'est lui qui la fait avancer
         * en payant ses instructions, et le timer, DIV et le port série la
         * suivent — ils comptent son horloge à lui.
         *
         * `systemCycles` est celle du MONDE : l'écran affiche 59,7 images par
         * seconde et le haut-parleur sort un la à 440 Hz, que le processeur batte
         * une ou deux fois plus vite. Le PPU et l'APU la suivent.
         *
         * En vitesse simple, les deux portent le même nombre. C'est la bascule
         * qui les sépare — et il est essentiel que celle-ci s'ACCUMULE plutôt que
         * de se recalculer depuis `totalCycles` : un compteur dérivé sauterait en
         * arrière de la moitié de toute l'histoire de la machine au moment du
         * changement de régime.
         */
        get systemCycles() {
            return this._systemHalfCycles / 2;
        }

        /**
         * Le régime en cours. Couture du lot 0 : elle rend toujours `false`, et
         * c'est KEY1 qui la fera mentir au lot 1. La poser d'abord permet de
         * prouver le câblage — qui regarde quelle montre — avant qu'il n'y ait
         * quoi que ce soit à basculer.
         */
        get doubleSpeed() {
            return this._doubleSpeed;
        }

        /**
         * LA BASCULE, demandée par `STOP` et par lui seul.
         *
         * Le CPU ne connaît pas la machine : il ANNONCE son arrêt, on décide ici
         * de ce que ça veut dire. Sans bascule armée, `STOP` reste ce qu'il a
         * toujours été chez nous — un drapeau que personne ne lit. C'est
         * volontaire : la veille du DMG (celle qui attend un appui sur la
         * manette) n'est utilisée par aucun jeu sous licence, et pandocs lui
         * consacre un diagramme entier de cas tordus.
         */
        onStop() {
            if (!this.cgb || !this.cgb.KEY1.armed) return;
            this._doubleSpeed = !this._doubleSpeed;
            this.cgb.KEY1.disarm();
            this.cpu.resumeFromStop();
            // Le processeur s'arrête le temps que l'oscillateur se stabilise. Ce
            // n'est pas du confort : `spsw-div` et `spsw-tima` mesurent
            // exactement ce que le timer a fait, ou pas, pendant cet arrêt.
            //
            // Et il n'a rien fait : DIV repart de zéro et ne tourne pas de tout
            // l'arrêt. Les deux gestes se posent AVANT le paiement, sinon le
            // timer voit passer les 8200 T-cycles d'un coup — de quoi faire
            // déborder TIMA deux fois au réglage le plus rapide, et lever deux
            // interruptions que la ROM n'attend pas.
            //
            // (La PHASE exacte du redémarrage du compteur — un cycle machine
            // avant le processeur, mesurée sur `spsw-div` — est l'affaire du
            // timer : voir `enterStopMode`.)
            //
            // L'ARRÊT SE COMPTE SUR LA MONTRE DU MONDE. Pandocs donne « 2050
            // cycles machine (8200 dots) » sans dire sur quelle montre, et la
            // question n'est pas académique : à l'aller le processeur bat deux
            // fois plus vite qu'au retour. On tranche pour le monde parce que
            // cet arrêt n'est pas un compte d'instructions — c'est un DÉLAI
            // PHYSIQUE, le temps que l'oscillateur se stabilise, et un délai
            // physique dure la même chose en secondes quel que soit le régime
            // qui en sortira. Le processeur, lui, paie deux fois plus de SES
            // cycles quand il en ressort en double régime.
            //
            // UNE INTERRUPTION EN ATTENTE COUPE L'ARRÊT COURT. Cet arrêt est un
            // `halt` déguisé, et il se réveille comme un `halt` : dès qu'une
            // source armée lève son drapeau. La bascule, elle, a bien lieu — ce
            // n'est pas elle qu'on interrompt, c'est l'attente qui la suit.
            //
            // Le manuel Nintendo déconseille explicitement de faire ça, et le
            // dépôt AGE raconte pourquoi : son auteur a rendu une vraie CGB E
            // instable en enchaînant ces ROMs, au point qu'un reset n'y
            // suffisait plus. On émule le comportement, pas le vice.
            const arret = this.pendingInterrupt
                ? 0
                : STOP_PAUSE * (this.doubleSpeed ? 2 : 1);
            this.timer.enterStopMode(arret);
            this.cpu.pay(arret);
        }

        /**
         * Une source ARMÉE qui a levé son drapeau — les cinq bits utiles, et
         * eux seuls : les trois du haut n'existent pas et se lisent à 1.
         *
         * C'est la condition de réveil d'un `halt`, et pas celle du SERVICE
         * d'une interruption : celle-là demande en plus `ime`, et c'est
         * `dispatch()` qui s'en charge. Les deux ne se confondent pas — un `halt`
         * se réveille les interruptions coupées, il ne saute simplement nulle
         * part.
         */
        get pendingInterrupt() {
            return (this.IE & this.IF & 0x1F) !== 0;
        }

        emitCyclesUpdate() {
            for (let o of this._observersCyclesUpdate) {
                o.call(null, this);
            }
        }

        get timer() {
            return this._timer;
        }

        /** Ce qu'on a DEMANDÉ : 'dmg', 'cgb' ou 'auto'. */
        get modelPreference() {
            return this._modelPreference;
        }

        /**
         * Ce qu'on EST : 'dmg' ou 'cgb'. Vaut null tant qu'aucune cartouche n'est
         * insérée — c'est elle qui tranche quand la préférence est 'auto'.
         */
        get model() {
            return this._model;
        }

        /**
         * Le boîtier décide, la cartouche renseigne. Une préférence explicite
         * l'emporte toujours : c'est ce qui permet de forcer une CGB avec une
         * cartouche qui ne se déclare pas — le cas de TOUTES les ROMs mooneye,
         * qui portent 0x143 = 0x00 et mesurent ce que la console a laissé.
         */
        /**
         * LE SEUL ENDROIT OÙ LE MODÈLE CHOISIT UNE CLASSE. La FIFO de fond est
         * injectée dans les deux cas : au lot 2 le CGB se contente de celle du
         * DMG, il ne diverge encore que sur la VRAM et ses registres.
         */
        initPPU(model) {
            const PPUClass = model === CGB ? CGBPPU(this) : PPU(this);
            this.ppu = new PPUClass(Fetcher);
        }

        /**
         * Le reste du CGB, celui qui n'est pas du dessin : les registres
         * indocumentés et les banques de WRAM. Null en DMG — et c'est cette
         * absence, et non un test de modèle, qui laisse la carte mémoire vide à
         * ces adresses-là.
         */
        initCgbSystem(model) {
            this.cgb = model === CGB ? new (CgbSystem(this)) : null;
        }

        resolveModel(cartridge) {
            if (this._modelPreference !== AUTO) return this._modelPreference;
            return cartridge?.header?.supportsCgb ? CGB : DMG;
        }

        get IE() {
            return this.memory._read(0xFFFF);
        }
        get IF() {
            return this.memory._read(0xFF0F);
        }
        set IE(value) {
            return this.memory._write(0xFFFF, value);
        }
        set IF(value) {
            return this.memory._write(0xFF0F, value);
        }

        get memory() {
            return this._memory;
        }

        onTimer(machine) {
            this.timer.check();
        }

        initTimer() {
            const timer = new (Timer(this));
            this._timer = timer;
            this.unsubscribeCycleUpdate(this._timerTickCallback);
            this.subscribeCycleUpdate(this._timerTickCallback);
        }

        start() {
            clock.start();
        }
        stop() {
            clock.stop();
        }

        /**
         * 
         * @param {*} byte 
         * @returns a byte like a 0x1 << n-first
         */
        getFisrtLowBit(byte) {
            return byte & -byte;
        }

        dispatch(isService=true) {
            /** choisir la source : le bit levé le plus bas gagne (VBlank bit 0 = priorité maximale, Joypad bit 4 = minimale) ;
                couper ime ;
                acquitter : éteindre ce bit-là dans IF (les autres continuent d'attendre) ;
                empiler PC, sauter au vecteur de la source — 0x40, 0x48, 0x50, 0x58, 0x60 (bit × 8 + 0x40 : des cousins de RST) ;
                facturer 5 cycles. */
            if (this.cpu.ime && this.IE & this.IF) {
                const source = this.getFisrtLowBit(this.IE & this.IF);
                const mask = 0xFF ^ source;
                this.cpu.di();
                this.IF = this.IF & mask;
                this.cpu.pay(2);
                this.cpu.stack.push(this.cpu.registers.PC.getValue());
                this.cpu.pay(1);
                const address = Math.log2(source) * 8 + 0x40;
                this.cpu.registers.PC.setValue(address);
            }
        }

        subscribeCycleUpdate(cb) {
            this._observersCyclesUpdate.push(cb);
        }

        unsubscribeCycleUpdate(cb) {
            this._observersCyclesUpdate = this._observersCyclesUpdate.filter(
                function(item) {
                    return item !== cb;
                }
            );
        }

        postStep() {
            const isScheduled = this.cpu.imeScheduled;
            if (!isScheduled) {
                // this.interruptsAcc = 1;
                return;
            };
            switch (this.interruptsAcc) {
                case 0:
                    this.interruptsAcc = 1;
                    this.cpu.start();
                    break;
                case 1:
                    this.interruptsAcc = 0;
                    break;
            }
        }

        onTick(cb) {
            this._tickObservers.push(cb);
        }

        emitTick() {
            for (let o of this._tickObservers) {
                o.call(null, this);
            }
        }

        handleTick(event) {
            let budget = DEFAULT_BUDGET;
            while (budget > 0) {
                if (this.cpu.halted && (this.IE & this.IF) !== 0) {
                    cpu.wake();
                }
                const deltaCycles = this.totalCycles;
                this.dispatch();
                if (this.cpu.halted) {
                    cpu.pay(1);
                } else {
                    this.decoder.step();
                }
                budget -= (this.totalCycles - deltaCycles);
                this.postStep();
            }
            this.emitTick();

        }

        plugCartridge(cartridge) {
            // Le modèle se fige ICI et pas avant : en 'auto' il dépend de la
            // cartouche, qui n'existe pas à la construction de la machine.
            this._model = this.resolveModel(cartridge);
            // Le PPU AVANT la mémoire : c'est lui qui déclare les registres à
            // router (VBK et, plus tard, les palettes), et MemoryBuilder les lit.
            this.initPPU(this._model);
            this.initCgbSystem(this._model);
            this.initTimer();
            const timer = this.timer;
            const newMemory = MemoryBuilder(
                cartridge,
                serial,
                timer,
                this.ppu,
                this.joypad,
                this.apu,
                this.cgb
            );
            this._memory = newMemory;
            this.cpu.initMemory(newMemory);
            cpu.postBoot(this._model);
        }
    }

    return Machine;
}