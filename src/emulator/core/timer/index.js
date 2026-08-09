import byte from "../../lib/byte";
import { Register } from "../../lib/register";

// La fenêtre du §TIMA Overflow, en T-CYCLES — l'unité de tout ce fichier.
// Vue de `machine.totalCycles`, qui compte en cycles machine, elle en vaut 1.
const WINDOW = 4;

// Le numéro du bit surveillé pour chacun des quatre réglages de TAC (doc §Timer
// Operation) : une table constante, elle vit au module. Elle était rebâtie à
// chaque lecture de `periode` et de `isSignal`, sur le chemin d'un `check()`
// appelé à tous les cycles machine.
const WATCHED_BIT = {
    0b00: 9,
    0b01: 3,
    0b10: 5,
    0b11: 7,
};

// Le détecteur de front, mutualisé entre DIV et TAC — les deux seuls registres dont
// l'écriture peut faire tomber le signal (bit surveillé du compteur ET bit 2 de TAC).
// Les sous-classes implémentent `_setValue` ; le wrapper photographie le signal avant
// et après, et pousse TIMA si la valeur est passée de 1 à 0.
//
// Les fronts dus au TEMPS ne passent pas par ici : `TIMAregister.getValue` les compte
// par soustraction sur la grille, sans avoir à les visiter un par un.
function Collapse(size) {
    class CollapseWatcher extends Register(size || 8) {
        constructor(parent) {
            super();
            this.parent = parent;
        }

        hookBeforeSetValue(value) {
            console.warn("Not implemented")
        }

        hookAfterSetValue(value) {
            console.warn("Not implemented")
        }

        hookAfterIncrement(value) {
            console.warn("Not implemented")
        }
        
        setValue(value) {
            const oldSignal = this.parent.isSignal;
            this.hookBeforeSetValue(value);
            super.setValue(value);
            this.hookAfterSetValue(value);
            if (oldSignal && !this.parent.isSignal) {
                this.parent._incrementTIMA();
                this.hookAfterIncrement(value);
            }
        }
        _setValue(value) {
            super.setValue(value);
        }
    }

    return CollapseWatcher;
} 

class DIVregister extends Collapse(8) {

    getValue() {
        const cycles = this.parent.innerCycles;
        const value = Math.floor(cycles / 256);
        return value & 0xFF;
    }

    // Le front descendant provoqué par le reset est géré par `Collapse` — la valeur
    // écrite est ignorée, seul compte le retour à zéro du compteur.
    //
    // Le réarmement est inconditionnel côté écriture (`hookAfterSetValue`) : remettre le
    // compteur à zéro déplace la grille, donc le rendez-vous, qu'il y ait eu un front ou
    // non. Le garde `isTAC` évite seulement de ressusciter une alarme que `check()` a
    // mise à l'infini.
    setValue(val) {
        return super.setValue(0);        
    }

    hookBeforeSetValue(value) {
        this.parent._capture();
        this.parent._innerCycles = this.parent.totalMachineCycles;
        // La même remise à zéro sur la montre du monde : c'est elle que lit le
        // séquenceur de trames de l'APU. Les deux origines bougent ENSEMBLE ou
        // le séquenceur cesse de suivre DIV — et c'est ce couplage-là que
        // blargg `dmg_sound` arbitre depuis toujours.
        this.parent._innerSystemCycles = this.parent.totalSystemCycles;
        this.parent.cranBase = 0;
    }

    hookAfterSetValue(value) {
        if (this.parent.isTAC) this.parent._armer();
    }
    
    // hookAfterIncrement(value) {
    //     console.warn("Not implemented");
    // }
}

class TIMAregister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }

    // Le zéro de la fenêtre §TIMA Overflow sort d'ici GRATUITEMENT : tant que `_reset`
    // n'a pas remplacé `base` par TMA, la somme vaut 0x100, donc 0x00 après le masque.
    // Rien de spécial à coder pour lui — il suffit que la recharge n'arrive pas trop tôt.
    getValue() {
        if (!this.parent.isTAC) return this.parent.base;
        const crans = Math.floor(this.parent.innerCycles / this.parent.periode);
        return (this.parent.base + (crans - this.parent.cranBase)) & 0xFF;
    }

    // Écrire pendant la fenêtre du §TIMA Overflow annule la recharge ET l'interruption :
    // `_armer()` recalcule `dateAlarme` depuis l'instant présent, donc le rendez-vous
    // part au loin et `check()` ne le voit plus. Là aussi, gratuit.
    //
    // Écrire PILE sur le cycle de la recharge, en revanche, est IGNORÉ : TMA gagne.
    // C'est la garde ci-dessous. Sans elle, l'écriture s'exécute juste après le `check()`
    // du même M-cycle — qui vient de recharger — et l'écraserait.
    // Vérifié par mooneye acceptance/timer/tima_write_reloading, dont les quatre sondes
    // séparées d'un M-cycle donnent $80 (avant), $7F (fenêtre), $FE (ICI), $7F (après).
    setValue(value) {
        if (this.parent.innerCycles === this.parent.lastReload) return;
        this.parent.base = value;
        super.setValue(value);
        this.parent._armer();
    }
}
class TACregister extends Collapse(8) {
    // Deux fronts possibles ici, tous deux pris en charge par `Collapse` : éteindre le
    // timer force le ET à 0 « despite the fact that the selected bit of the counter
    // didn't change » (doc §An Edge Case), et changer les bits 1-0 déplace la prise sur
    // un bit qui peut valoir 0 alors que l'ancien valait 1.
    //
    // L'ordre compte : `_capture()` lit la valeur à travers l'ANCIEN TAC, `_armer()`
    // réancre avec le NOUVEAU. Les deux ne peuvent pas tenir du même côté de l'écriture.
    hookBeforeSetValue(value) {
        this.parent._capture();
    }

    hookAfterSetValue(value) {
        if (value & 0x4) this.parent._armer();
    }
    
    // hookAfterIncrement(value) {
    //     console.warn("Not implemented");
    // }
}

class TMAregister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }
    
    setValue(value) {
        if (this.parent.innerCycles === this.parent.lastReload) this.parent.base = value;
        super.setValue(value);
    }
}

export default function(machine) {
    class Timer {
        constructor() {
            this.machine = machine;
            this._innerCycles = this.totalMachineCycles; // Almost a bad boy. Whatcha gonna do !!
            // LA MÊME ORIGINE, SUR L'AUTRE MONTRE. Le compteur du timer est
            // celui du PROCESSEUR, et c'est bien lui que DIV et TIMA lisent.
            // Mais l'APU tire son séquenceur de trames du MÊME compteur remis à
            // zéro aux mêmes instants, tout en devant garder ses 512 Hz dans le
            // monde réel. On note donc la remise à zéro sur les deux montres, et
            // chacun lit la sienne. Voir `innerSystemCyclesAt`.
            this._innerSystemCycles = this.totalSystemCycles;
            this.DIV = new DIVregister(this);
            this.TIMA = new TIMAregister(this);
            this.TAC = new TACregister(this);
            this.TMA = new TMAregister(this);

            this.base = 0;
            this.dateAlarme = Infinity;
            this.lastReload = -Infinity;
            this.cranBase = 0;

            // Figée après construction : les quatre registres ne sont jamais remplacés.
            this._registersMapping = {
                0xFF04: this.DIV,
                0xFF05: this.TIMA,
                0xFF06: this.TMA,
                0xFF07: this.TAC,
            };
        }

        innerCyclesAt(cycle) {
            return 4 * (cycle - this._innerCycles);
        }

        /**
         * LE MÊME COMPTEUR, LU DEPUIS LE MONDE — c'est l'APU qui s'en sert.
         *
         * Son séquenceur de trames est cadencé par DIV, donc par la montre du
         * processeur, MAIS il doit rester à 512 Hz dans le monde réel. Le
         * matériel résout ça en changeant de bit surveillé (bit 4 en simple,
         * bit 5 en double) ; chez nous ça revient à compter la même période sur
         * la montre du monde, qui ne s'accélère pas.
         *
         * Ce qu'il ne fallait PAS faire, et qui était fait : passer une date du
         * monde à `innerCyclesAt`, dont l'origine est sur la montre du
         * processeur. Tant que les deux montres portent le même nombre ça
         * marche ; à la première bascule le séquenceur RECULE de quatre pas —
         * mesuré — et rejoue quatre pas de compteur de longueur, d'enveloppe et
         * de balayage.
         */
        innerSystemCyclesAt(cycle) {
            return 4 * (cycle - this._innerSystemCycles);
        }

        /**
         * CE QUE `STOP` FAIT AU TIMER : il remet le compteur à zéro, ET C'EST
         * TOUT. Il ne le gèle pas.
         *
         * Ce fichier a porté le contraire, sur la foi de pandocs (§FF04) :
         * *« this register is reset when executing the `stop` instruction, and
         * only begins ticking again once stop mode ends. »* Ce sont les ROMs qui
         * ont retourné la lecture, et l'illusion est belle : l'arrêt dure 131072
         * T-cycles, soit EXACTEMENT 512 crans de DIV. Un compteur qui tourne
         * pendant tout ce temps revient donc sur la même valeur — indiscernable
         * d'un compteur gelé, tant qu'on ne regarde que DIV.
         *
         * Ce qui tranche est ailleurs : TIMA au réglage 4 kHz. Sa période vaut
         * 1024 T, donc l'arrêt lui vaut 128 incréments — et 128 n'est PAS un
         * multiple de 256. `spsw-tima` attend $80 là où un compteur gelé rend
         * $00, et c'est la seule des quatre cadences capable de le dire : les
         * trois autres tombent sur des multiples de 256 et rendent la même chose
         * dans les deux modèles.
         *
         * La remise à zéro passe par le chemin ORDINAIRE de DIV, pour que le
         * front descendant du §An Edge Case joue ici comme partout : écrire DIV
         * peut pousser TIMA d'un cran, et cette bizarrerie vaut aussi pour
         * `STOP`.
         *
         * (La PHASE, elle, est dans `STOP_PAUSE` côté machine : le +1 de 32769
         * est mesuré sur `spsw-div`, qui lit DIV 61 cycles après la bascule et
         * attend 1.)
         */
        enterStopMode() {
            this.DIV.setValue(0);
        }

        get innerCycles() {
            return this.innerCyclesAt(this.totalMachineCycles);
        }
        
        get totalMachineCycles() {
            return this.machine.totalCycles;
        }

        /** L'heure du monde, celle que l'APU lit. Voir `innerSystemCyclesAt`. */
        get totalSystemCycles() {
            return this.machine.systemCycles;
        }

        get registersMapping() {
            return this._registersMapping;
        }

        get periodMapping() {
            return WATCHED_BIT;
        }

        // `periodMapping` donne le numéro de bit du compteur surveillé (doc §Timer
        // Operation). La période s'en déduit : un bit fait son cycle complet en
        // 2^(bit+1) T-cycles, donc un seul front descendant par 2^(bit+1).
        // Tout ce fichier compte en T-CYCLES — d'où le ×4 dans `innerCycles`, qui
        // reçoit des cycles machine. Changer d'unité décale les 4 indices de 2.
        get periode() {
            const value = 2 ** (this.periodMapping[this.TAC.getValue() & 0b11] + 1)
            return value;
        }

        get isTAC() {
            return  (this.TAC.getValue() & 0x4) > 0
        }

        get isSignal() {
            const mask = 1 << this.periodMapping[this.TAC.getValue() & 0b11];
            const isBitCounter = (this.innerCycles & mask) > 0;
            return this.isTAC && isBitCounter;
        }

        _resetCrans() {
            this.cranBase = Math.floor(this.innerCycles / this.periode);

        }

        // Le matériel ne planifie aucune date, il compare le résultat du ET à celui du
        // cycle précédent. L'alarme est une optimisation équivalente TANT QU'ELLE DÉRIVE
        // DU COMPTEUR : `cranBase` est une position sur la grille des fronts, pas un
        // instant d'écriture, donc le rendez-vous tombe toujours SUR une barre.
        //
        // Elle couvre les fronts dus au TEMPS. Ceux dus aux écritures passent par
        // `Collapse`. Les deux ne se rejoindront qu'une fois la machine capable
        // d'avancer cycle par cycle — alors l'alarme deviendra inutile.
        _armer() {
            this._resetCrans();
            this.dateAlarme = (this.cranBase + (0x100 - this.base)) * this.periode;
        }
        /**
         * Matérialise la valeur courante de TIMA dans `base`. À appeler AVANT tout
         * changement de référentiel (écriture de TAC ou de DIV) : une fois le référentiel
         * changé, `getValue()` ne sait plus recalculer la valeur d'avant.
         * Inoffensif si le timer est éteint — `getValue()` rend alors `base`, qu'on
         * réécrit à l'identique. Donc appelable inconditionnellement.
         */
        _capture() {
            this.base = this.TIMA.getValue();
            this._resetCrans();
        }

        _incrementTIMA() {
            this.base ++;
            if (this.base > 0xFF) {
                this._reset(this.innerCycles);
            }
            this._armer();
        }

        // `origin` = la position du compteur où le débordement a EU LIEU, pas l'heure
        // courante. Les deux appelants ne donnent pas la même chose : `check()` passe
        // `dateAlarme` (le rendez-vous qui vient de tomber, parfois loin derrière si
        // plusieurs ont été enjambés), `_incrementTIMA()` passe `innerCycles` (le
        // débordement vient d'une écriture, il a donc lieu maintenant). Se tromper de
        // référence décale `cranBase`, et TIMA repart avec un écart constant.
        _reset(origin) {
            this._getupIF();
            this.base = this.TMA.getValue();
            this.cranBase = Math.floor(origin / this.periode);
            this.lastReload = origin + WINDOW;
        }

        _getupIF() {
            this.machine.IF |= 0b00100;
        }

        // Chaque tour se recale sur `dateAlarme` — le rendez-vous manqué — et jamais sur
        // l'heure courante. C'est ce qui rend le rattrapage exact quand plusieurs
        // débordements ont été enjambés d'un coup.
        //
        // Le `+ WINDOW` est le §TIMA Overflow : entre le débordement et ses
        // effets, le matériel laisse passer 4 T-cycles. Pendant cette fenêtre TIMA lit
        // déjà 0x00 (voir `TIMAregister.getValue`), mais TMA n'est pas encore lu et IF
        // pas encore levé — c'est ce délai qui rend observables les écritures faites
        // pendant la fenêtre. Couvert par `timer-overflow.test.js`.
        check() {
            if (!this.isTAC) {
                this.dateAlarme = Infinity;
                return;
            }
            while (this.innerCycles >= this.dateAlarme + WINDOW) {
                this._reset(this.dateAlarme);
                this.dateAlarme += (0x100 - this.base) * this.periode;
            }
        }

        /**
         * TAC n'a que trois bits ; les cinq du haut se lisent à 1 (`unused_hwio` :
         * `test TAC %11111000`). Les autres registres du timer n'ont aucun bit
         * mort, d'où une table à une seule entrée plutôt qu'un cas particulier
         * noyé dans la lecture.
         */
        get readMasks() {
            return { 0xFF07: 0xF8 };
        }

        read (addr) {
            return this.registersMapping[addr].getValue() | (this.readMasks[addr] || 0);
        };

        write (addr, value) {
            return this.registersMapping[addr].setValue(value);
        };

    }

    return Timer;
}