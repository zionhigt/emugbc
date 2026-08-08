import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from '../machine';
import buildPPU, { Fetcher } from './index';

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

// La géométrie de l'écran, en cycles machine :
//   1 ligne = 114 cycles ; 1 trame = 154 lignes = 17 556 cycles (= le budget !)
//   lignes 0-143 : visibles ; lignes 144-153 : VBlank
//   la frappe VBlank (IF bit 0) part au PASSAGE à la ligne 144
const LIGNE = 114;
const TRAME = LIGNE * 154;
const VBLANK_AT = LIGNE * 144; // 16 416 cycles : le premier début de VBlank

const LY = 0xff44;

const makePPU = () => {
  const knocks = [];
  const machine = {
    totalCycles: 0,
    _if: 0,
    get IF() { return this._if; },
    set IF(v) { knocks.push(v); this._if = v; },
    // un bus muet : check() peint des lignes en passant, il lui faut une VRAM
    memory: { read: () => 0, write: () => {}, _read: () => 0, _write: () => {} },
  };
  const PPU = buildPPU(machine);
  return { machine, knocks, ppu: new PPU(Fetcher) };
};

/**
 * LA COUTURE DU LOT 0 — le PPU ne construit plus sa FIFO de fond, on la lui
 * injecte.
 *
 * C'est le point d'entrée du CGB : il fournira la sienne, celle qui va lire
 * l'étiquette de tuile rangée dans la banque 1 de VRAM. Ces tests ne mesurent
 * aucun comportement de rendu — ils tiennent la couture elle-même : qu'elle
 * existe, qu'elle serve VRAIMENT au rendu (et pas seulement à ranger un objet
 * dans un champ), et qu'on ne puisse pas l'oublier en silence.
 */
describe('la FIFO de fond est injectée, pas construite', () => {
  const quietMachine = () => ({
    totalCycles: 0,
    _if: 0,
    get IF() { return this._if; },
    set IF(v) { this._if = v; },
    memory: { read: () => 0, write: () => {}, _read: () => 0, _write: () => {} },
  });

  it('le Fetcher du DMG est exporté : une classe CGB pourra en dériver', () => {
    expect(typeof Fetcher).toBe('function');
    expect(typeof Fetcher.prototype.renderFifo, 'c\'est renderFifo qu\'on surchargera').toBe('function');
  });

  it('le PPU instancie la classe reçue, en se passant lui-même comme parent', () => {
    const parents = [];
    class SpyFetcher extends Fetcher {
      constructor(parent) { super(parent); parents.push(parent); }
    }
    const PPU = buildPPU(quietMachine());
    const ppu = new PPU(SpyFetcher);

    expect(ppu.fetcher, 'c\'est bien la classe injectée qui sert').toBeInstanceOf(SpyFetcher);
    expect(parents[0], 'le PPU se passe lui-même').toBe(ppu);
  });

  it('le rendu d\'une ligne passe par la FIFO injectée', () => {
    const lines = [];
    class SpyFetcher extends Fetcher {
      renderFifo(line) { lines.push(line); }
    }
    const PPU = buildPPU(quietMachine());
    new PPU(SpyFetcher).renderLine(42);

    expect(lines, 'renderLine délègue à la FIFO reçue, pas à une autre').toEqual([42]);
  });

  it('oublier la FIFO échoue à la construction, pas au premier pixel', () => {
    const PPU = buildPPU(quietMachine());
    // Pas de valeur par défaut : un défaut ferait retomber le CGB sur la FIFO
    // DMG en silence, et la panne se lirait comme un bug de rendu.
    expect(() => new PPU()).toThrow(/Fetcher/);
  });
});

/**
 * LES AUTRES COUTURES DU LOT 0.
 *
 * Le CGB ne change pas le trajet du pixel : il change ce qu'on LIT au passage
 * (l'étiquette de tuile, rangée dans la banque 1 de VRAM) et COMMENT on colorie.
 * Ces deux choses étaient écrites en clair au milieu des boucles, et recopiées —
 * le coloriage du fond l'était deux fois, dans le fetcher et dans la fenêtre.
 *
 * Chaque test ici DESSINE vraiment avant de conclure : une couture qu'on se
 * contente de déclarer sans vérifier qu'elle est sur le trajet du pixel ne vaut
 * rien, c'est exactement l'erreur qui laisserait le CGB peindre en DMG.
 */
describe('les coutures du lot 0 : ce que le CGB surchargera', () => {
  const makeBench = () => {
    const ram = new Uint8Array(0x10000);
    const machine = {
      totalCycles: 0,
      _if: 0,
      get IF() { return this._if; },
      set IF(v) { this._if = v; },
      memory: { read: (a) => ram[a], write: (a, v) => { ram[a] = v; }, _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; } },
    };
    return { ram, machine, PPU: buildPPU(machine) };
  };

  // écran allumé, BG allumé, adressage 0x8000, carte 0x9800
  const LCDC_BASE = 0b1001_0001;
  const setup = (ppu, lcdc = LCDC_BASE) => {
    ppu.write(0xff40, lcdc);
    ppu.write(0xff47, 0b1110_0100); // BGP identité
    ppu.write(0xff48, 0b1110_0100); // OBP0 identité
    return ppu;
  };

  // une tuile unie, tous ses pixels à la même teinte
  const solidTile = (ram, id, shade) => {
    for (let r = 0; r < 8; r++) {
      ram[0x8000 + id * 16 + r * 2] = (shade & 1) ? 0xff : 0x00;
      ram[0x8000 + id * 16 + r * 2 + 1] = (shade >> 1) ? 0xff : 0x00;
    }
  };

  describe('tileAttributes : l\'étiquette de la tuile', () => {
    it('rend 0 en DMG — le neutre : pas de miroir, pas de palette, pas de priorité', () => {
      const { PPU } = makeBench();
      expect(new PPU(Fetcher).tileAttributes(0x9800)).toBe(0);
    });

    it('est demandée à l\'adresse de la CARTE, là où l\'identifiant a été lu', () => {
      const { machine, PPU } = makeBench();
      const asked = [];
      class Spy extends PPU {
        tileAttributes(mapAddress) { asked.push(mapAddress); return 0; }
      }
      setup(new Spy(Fetcher)).renderLine(0);

      expect(asked.length, 'une étiquette par tuile lue').toBeGreaterThan(0);
      expect(
        asked.every((a) => a >= 0x9800 && a <= 0x9bff),
        'toujours dans la carte, jamais dans les motifs',
      ).toBe(true);
    });

    it('chaque pixel porte l\'étiquette de SA tuile, pas celle de la suivante', () => {
      // Le piège du pipeline : la tuile suivante est allée chercher son
      // identifiant alors qu'il reste sept pixels de la précédente à sortir.
      // Sans le verrou posé au moment de l'empilement, ces sept-là prendraient
      // l'étiquette d'après — invisible en DMG (tout vaut 0), fatal en CGB.
      const { ram, PPU } = makeBench();
      for (let i = 0; i < 20; i++) ram[0x9800 + i] = i; // carte : tuile i en case i

      class Spy extends PPU {
        tileAttributes(mapAddress) { return this.bus.ppuRead(mapAddress); } // étiquette = identifiant
        backgroundColor(shade, attrs) { return attrs; }                     // on peint l'étiquette
      }
      const ppu = setup(new Spy(Fetcher));
      ppu.renderLine(0);

      expect([...ppu.screen.slice(0, 24)], 'huit pixels par étiquette, dans l\'ordre').toEqual(
        [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2],
      );
    });
  });

  describe('backgroundColor : un seul coloriage pour le fond ET la fenêtre', () => {
    // 7 est impossible par le chemin DMG réel (il ne rend que 0-3) : le trouver
    // à l'écran prouve que le pixel est passé par la couture.
    it('le fond passe par la couture', () => {
      const { PPU } = makeBench();
      class SpyPPU extends PPU {
        backgroundColor() { return 7; }
      }
      const ppu = setup(new SpyPPU(Fetcher));
      ppu.renderLine(0);

      expect([...ppu.screen.slice(0, 160)].every((p) => p === 7)).toBe(true);
    });

    it('la fenêtre aussi — c\'était la seconde copie de la même expression', () => {
      const { PPU } = makeBench();
      let windows = 0;
      class SpyPPU extends PPU {
        backgroundColor() { return 7; }
        renderWindow(line) { windows++; return super.renderWindow(line); }
      }
      const ppu = setup(new SpyPPU(Fetcher), LCDC_BASE | 0b0010_0000); // bit 5 : fenêtre
      ppu.write(0xff4a, 0);  // WY = 0
      ppu.write(0xff4b, 7);  // WX = 7 : la fenêtre commence à x = 0
      ppu.renderLine(0);

      expect(windows, 'la fenêtre a bien été dessinée').toBe(1);
      expect([...ppu.screen.slice(0, 160)].every((p) => p === 7)).toBe(true);
    });
  });

  describe('spriteColor et spriteOrder', () => {
    const withSprite = (ram) => {
      solidTile(ram, 1, 1);          // tuile 1 : teinte 1 partout (non transparente)
      ram[0xfe00] = 16;              // y = 16 -> ligne 0
      ram[0xfe01] = 8;               // x = 8  -> colonne 0
      ram[0xfe02] = 1;               // tuile 1
      ram[0xfe03] = 0;               // attributs
    };

    it('spriteColor colorie les sprites', () => {
      const { ram, PPU } = makeBench();
      withSprite(ram);
      class SpyPPU extends PPU {
        spriteColor() { return 7; }
      }
      const ppu = setup(new SpyPPU(Fetcher), LCDC_BASE | 0b0000_0010); // bit 1 : objets
      ppu.renderLine(0);

      expect(ppu.screen[0], 'le pixel du sprite vient de la couture').toBe(7);
    });

    it('spriteOrder est consulté avant de dessiner', () => {
      const { ram, PPU } = makeBench();
      withSprite(ram);
      let orders = 0;
      class SpyPPU extends PPU {
        spriteOrder(visibles) { orders++; return super.spriteOrder(visibles); }
      }
      setup(new SpyPPU(Fetcher), LCDC_BASE | 0b0000_0010).renderLine(0);

      expect(orders).toBeGreaterThan(0);
    });

    it('l\'ordre DMG est conservé : X décroissant, l\'index OAM départage', () => {
      // Décroissant parce que renderSprites écrase au fur et à mesure : le
      // DERNIER dessiné gagne, donc le plus petit X doit passer en dernier.
      const { PPU } = makeBench();
      const ordered = new PPU(Fetcher).spriteOrder([
        { x: 10, index: 0 },
        { x: 5, index: 1 },
        { x: 10, index: 2 },
      ]);

      expect(ordered.map((s) => [s.x, s.index])).toEqual([[10, 2], [10, 0], [5, 1]]);
    });
  });

  describe('le bus', () => {
    it('est le MÊME objet d\'un appel à l\'autre', () => {
      // Il était rebâti à chaque accès, et le fetcher l'appelle plusieurs fois
      // par pixel : un objet de deux méthodes alloué ~100 000 fois par trame.
      const { PPU } = makeBench();
      const ppu = new PPU(Fetcher);
      expect(ppu.bus).toBe(ppu.bus);
    });

    it('ppuReadBank ignore la banque en DMG : il n\'y a qu\'une VRAM', () => {
      const { ram, PPU } = makeBench();
      ram[0x8000] = 0x42;
      const { bus } = new PPU(Fetcher);

      expect(bus.ppuReadBank(0x8000, 0)).toBe(0x42);
      expect(bus.ppuReadBank(0x8000, 1), 'la banque 1 n\'existe pas encore').toBe(0x42);
    });
  });

  describe('la table de registres', () => {
    const fakeRegister = () => ({
      _v: 0,
      getValue() { return this._v; },
      setValue(v) { this._v = v; },
    });

    it('une sous-classe y ajoute les siens, et read/write les atteignent', () => {
      const { PPU } = makeBench();
      class WithVBK extends PPU {
        constructor(FetcherClass) {
          super(FetcherClass);
          this.VBK = fakeRegister();
        }
        buildRegistersMapping() {
          return { ...super.buildRegistersMapping(), 0xff4f: this.VBK };
        }
      }
      const ppu = new WithVBK(Fetcher);
      ppu.write(0xff4f, 1);

      expect(ppu.read(0xff4f), 'le registre ajouté répond').toBe(1);
      expect(ppu.read(0xff44), 'les registres de base répondent toujours').toBeDefined();
    });

    it('la table est bâtie APRÈS le constructeur de la sous-classe', () => {
      // Si elle était figée dans le constructeur de base, `this.VBK` n'existerait
      // pas encore au moment de la bâtir : les champs d'une sous-classe ne sont
      // posés qu'au retour de `super()`. La construction paresseuse règle ça.
      const { PPU } = makeBench();
      class WithVBK extends PPU {
        constructor(FetcherClass) {
          super(FetcherClass);
          this.VBK = fakeRegister();
        }
        buildRegistersMapping() {
          return { ...super.buildRegistersMapping(), 0xff4f: this.VBK };
        }
      }
      expect(new WithVBK(Fetcher).registersMapping[0xff4f]).toBeDefined();
    });
  });
});

describe('PPU fantôme : il bat, il ne dessine pas', () => {
  it('la factory (machine injectée) rend la classe : read, write et check exposés', () => {
    const { ppu } = makePPU();
    for (const m of ['read', 'write', 'check']) {
      expect(typeof ppu[m], `${m} doit être appelable`).toBe('function');
    }
  });

  describe('les registres LCD ordinaires : stockage nu, en attendant leurs vrais rôles', () => {
    it.each([
      { addr: 0xff40, nom: 'LCDC' },
      { addr: 0xff42, nom: 'SCY' },
      { addr: 0xff45, nom: 'LYC' },
      { addr: 0xff47, nom: 'BGP' },
      { addr: 0xff4b, nom: 'WX (la dernière adresse du bloc)' },
    ])('$nom (écrit puis relu)', ({ addr }) => {
      const { ppu } = makePPU();
      ppu.write(addr, 0x42);
      expect(hex(ppu.read(addr), 2), 'la valeur doit survivre').toBe('0x42');
    });
  });

  // Depuis la migration au décompte, LY n'est plus DÉRIVÉ de l'horloge : il LIT
  // `line`, un état que seul check() fait avancer. La vraie machine appelle
  // check() à chaque cycle ; ici on le pilote après chaque saut d'horloge, sinon
  // `line` resterait figé.
  describe('LY : le numéro de ligne — la source de vérité `line`, avancée par check()', () => {
    it('suit le balayage : ligne = totalCycles ÷ 114', () => {
      const { machine, ppu } = makePPU();
      expect(ppu.read(LY), 'trame naissante : ligne 0').toBe(0);
      machine.totalCycles = LIGNE; ppu.check(); // 114 cycles
      expect(ppu.read(LY), 'une ligne complète balayée').toBe(1);
      machine.totalCycles = LIGNE * 5 + 57; ppu.check(); // au milieu de la 6e ligne
      expect(ppu.read(LY), 'en plein milieu d\'une ligne : toujours la ligne 5').toBe(5);
      machine.totalCycles = LIGNE * 143; ppu.check();
      expect(ppu.read(LY), 'la dernière ligne visible').toBe(143);
      machine.totalCycles = VBLANK_AT; ppu.check();
      expect(ppu.read(LY), 'l\'entrée en VBlank').toBe(144);
    });

    it('boucle à 154 : la trame suivante repart à zéro', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = TRAME; ppu.check();
      expect(ppu.read(LY), 'ligne 154 = ligne 0 de la trame suivante').toBe(0);
      machine.totalCycles = TRAME + LIGNE * 6; ppu.check();
      expect(ppu.read(LY), 'et le balayage continue').toBe(6);
    });

    it('LY est en lecture seule : écrire ne change rien (le balayage n\'obéit à personne)', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = LIGNE * 10; ppu.check();
      ppu.write(LY, 0x77);
      expect(ppu.read(LY), 'le faisceau est à la ligne 10, point').toBe(10);
    });
  });

  describe('la frappe VBlank : IF bit 0 au passage à la ligne 144, une fois par trame', () => {
    it('avant la ligne 144 : aucun coup ne part', () => {
      const { machine, knocks, ppu } = makePPU();
      machine.totalCycles = VBLANK_AT - 1;
      ppu.check();
      expect(knocks, 'la 143e ligne se dessine encore').toEqual([]);
    });

    it('au passage : UNE frappe, IF bit 0', () => {
      const { machine, knocks, ppu } = makePPU();
      machine.totalCycles = VBLANK_AT;
      ppu.check();
      expect(knocks.length, 'le début du VBlank').toBe(1);
      expect(machine.IF & 0b00001, 'le bit VBlank levé').toBe(0b00001);
    });

    it('pas de re-frappe dans la même trame : le VBlank ne sonne qu\'à son entrée', () => {
      const { machine, knocks, ppu } = makePPU();
      machine.totalCycles = VBLANK_AT;
      ppu.check();
      machine.totalCycles = VBLANK_AT + 500; // toujours dans le VBlank (lignes 144-153)
      ppu.check();
      expect(knocks.length, 'une entrée = un coup, pas un par check').toBe(1);
    });

    it('rattrapage : trois trames enjambées = trois frappes', () => {
      const { machine, knocks, ppu } = makePPU();
      machine.totalCycles = VBLANK_AT + TRAME * 2 + 10; // 3 débuts de VBlank dépassés
      ppu.check();
      expect(knocks.length, 'chaque trame manquée doit son battement — un while').toBe(3);
    });
  });

  describe('LCDC bit 7 : l\'interrupteur de l\'écran — le temps du PPU se gèle et renaît', () => {
    const ON = 0b1001_0001; // le LCDC post-boot : écran + BG + adressage 0x8000
    const OFF = 0b0001_0001; // les mêmes réglages, écran coupé

    it('LCDC naît à 0x91 : la boot ROM laisse l\'écran ALLUMÉ derrière elle', () => {
      const { ppu } = makePPU();
      expect(ppu.read(0xff40), 'l\'état post-boot, comme les registres du CPU').toBe(0x91);
    });

    it('éteint : LY gèle à 0, quel que soit le temps qui passe', () => {
      const { machine, ppu } = makePPU();
      ppu.write(0xff40, OFF);
      machine.totalCycles = 114 * 50;
      expect(ppu.read(LY), 'le faisceau est physiquement arrêté').toBe(0);
    });

    it('éteint : le VBlank se tait — aucune frappe, même après des trames entières', () => {
      const { machine, knocks, ppu } = makePPU();
      ppu.write(0xff40, OFF);
      machine.totalCycles = TRAME * 3;
      ppu.check();
      expect(knocks, 'un écran éteint n\'a pas de battement').toEqual([]);
    });

    it('éteindre efface la dalle en blanc (teinte 0) — pas de fossiles de la dernière image', () => {
      const { ppu } = makePPU();
      ppu.screen.fill(3); // une image quelconque à l\'écran
      ppu.write(0xff40, OFF);
      expect(ppu.screen.every((p) => p === 0), 'LCD coupé = dalle laiteuse').toBe(true);
    });

    it('rallumer : la trame repart de ZÉRO — l\'ancre renaît', () => {
      const { machine, ppu } = makePPU();
      ppu.write(0xff40, OFF);
      machine.totalCycles = 1000; // du temps passe, écran noir... blanc
      ppu.write(0xff40, ON);
      machine.totalCycles = 1000 + 114 * 5 + 3;
      ppu.check();
      expect(
        ppu.read(LY),
        'ligne 5 depuis le RALLUMAGE — pas la ligne 8 de l\'horloge brute',
      ).toBe(5);
    });

    it('rallumer : le VBlank reprend sur la nouvelle grille (144 lignes après l\'ancre)', () => {
      const { machine, knocks, ppu } = makePPU();
      ppu.write(0xff40, OFF);
      machine.totalCycles = 1000;
      ppu.write(0xff40, ON);
      machine.totalCycles = 1000 + VBLANK_AT - 1;
      ppu.check();
      expect(knocks.length, 'pas encore : la 144e ligne de la nouvelle trame n\'est pas là').toBe(0);
      machine.totalCycles = 1000 + VBLANK_AT;
      ppu.check();
      expect(knocks.length, 'la frappe, recalée sur l\'ancre du rallumage').toBe(1);
    });

    it('réécrire LCDC SANS toucher au bit 7 ne ré-ancre RIEN — seule la transition compte', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = 114 * 4; ppu.check(); // la trame court depuis 0, ligne 4
      ppu.write(0xff40, 0b1011_0001); // toujours allumé, on a juste ouvert la fenêtre (bit 5)
      expect(
        ppu.read(LY),
        'les jeux réécrivent LCDC sans arrêt : un ré-ancrage ici gèlerait la trame pour toujours',
      ).toBe(4);
    });

    // Quirk d'allumage (lcdon_timing) : le PREMIER frame après un rallumage LCD
    // ne fait PAS de scan OAM sur la ligne 0. Elle démarre en mode 0 et file
    // droit en mode 3 — puis tout redevient normal dès la ligne 1. (Le décalage
    // « 2 T-cycles » exact est sous notre granularité, réglage fin plus tard.)
    it('allumage : la ligne 0 démarre en mode 0 puis file en mode 3 (pas de scan OAM)', () => {
      const { machine, ppu } = makePPU();
      ppu.write(0xff40, OFF);
      machine.totalCycles = 1000;
      ppu.write(0xff40, ON); // rallumage → wake
      machine.totalCycles = 1000 + 5; ppu.check();
      expect(ppu.mode, 'ligne 0 démarre en mode 0, pas en scan OAM (mode 2)').toBe(0);
      expect(ppu.line, 'toujours ligne 0').toBe(0);
      machine.totalCycles = 1000 + 30; ppu.check();
      expect(ppu.mode, 'puis file direct en mode 3').toBe(3);
      machine.totalCycles = 1000 + 130; ppu.check();
      expect(ppu.line, 'ligne 1 atteinte').toBe(1);
      expect(ppu.mode, 'ligne 1 : scan OAM normal (mode 2)').toBe(2);
    });
  });

  describe('les pixels : le décor, tuile par tuile', () => {
    // Le gréement : une vraie ram de 64 Ko derrière un bus minimal, la
    // machine factice par-dessus — le PPU lit la VRAM par le bus, comme convenu.
    const makeRig = () => {
      const ram = new Uint8Array(0x10000);
      const knocks = [];
      const machine = {
        totalCycles: 0,
        _if: 0,
        get IF() { return this._if; },
        set IF(v) { knocks.push(v); this._if = v; },
        memory: { read: (a) => ram[a], write: (a, v) => { ram[a] = v; }, _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; } },
      };
      const PPU = buildPPU(machine);
      const ppu = new PPU(Fetcher);
      // réglage de base : ÉCRAN allumé (bit 7 !), BG allumé, adressage 0x8000, carte 0x9800
      ppu.write(0xff40, 0b1001_0001);
      ppu.write(0xff47, 0b1110_0100); // BGP identité : 0=0, 1=1, 2=2, 3=3
      return { ram, machine, knocks, ppu };
    };

    // Encode 8 rangées de 8 teintes (0-3) au format 2bpp : par rangée,
    // l'octet des bits FAIBLES puis l'octet des bits FORTS.
    const poseTuile = (ram, id, rows, base = 0x8000) => {
      rows.forEach((row, r) => {
        let lo = 0;
        let hi = 0;
        row.forEach((c, x) => {
          lo |= (c & 1) << (7 - x);
          hi |= ((c >> 1) & 1) << (7 - x);
        });
        ram[base + id * 16 + r * 2] = lo;
        ram[base + id * 16 + r * 2 + 1] = hi;
      });
    };

    const RAMPE = [0, 1, 2, 3, 0, 1, 2, 3]; // la rangée-témoin
    const tuileRampe = Array(8).fill(RAMPE);

    it('ppu.screen : 160 × 144 teintes, blanc (0) à la naissance', () => {
      const { ppu } = makeRig();
      expect(ppu.screen.length, 'un pixel par point d\'écran').toBe(160 * 144);
      expect(ppu.screen.every((p) => p === 0), 'écran vierge').toBe(true);
    });

    it('décodage 2bpp : la tuile 0 en case (0,0), renderLine(0) déroule ses teintes', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 0, tuileRampe);
      ram[0x9800] = 0; // case (0,0) = tuile 0
      ppu.renderLine(0);
      expect(
        Array.from(ppu.screen.slice(0, 8)),
        'bits faibles + bits forts recombinés, pixel par pixel',
      ).toEqual(RAMPE);
    });

    it('chaque ligne lit SA rangée : rangée 1 distincte, renderLine(1) la retrouve', () => {
      const { ram, ppu } = makeRig();
      const rows = Array(8).fill([0, 0, 0, 0, 0, 0, 0, 0]);
      rows[1] = [3, 3, 0, 0, 1, 1, 2, 2];
      poseTuile(ram, 0, rows);
      ppu.renderLine(1);
      expect(Array.from(ppu.screen.slice(160, 168)), 'la rangée 1 de la tuile').toEqual(rows[1]);
    });

    it('BGP traduit : palette inversée, les teintes se retournent', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 0, tuileRampe);
      ppu.write(0xff47, 0b0001_1011); // 0→3, 1→2, 2→1, 3→0
      ppu.renderLine(0);
      expect(
        Array.from(ppu.screen.slice(0, 8)),
        'teinte finale = (BGP >> teinte×2) & 3',
      ).toEqual([3, 2, 1, 0, 3, 2, 1, 0]);
    });

    it('la carte : case (1,0) = autre tuile → pixels 8-15 ; ligne 8 = rangée suivante de la carte', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 1, Array(8).fill([1, 1, 1, 1, 1, 1, 1, 1]));
      poseTuile(ram, 2, Array(8).fill([2, 2, 2, 2, 2, 2, 2, 2]));
      ram[0x9800 + 1] = 1; // case (1,0)
      ram[0x9800 + 32] = 2; // case (0,1) — la carte fait 32 cases de large
      ppu.renderLine(0);
      expect(Array.from(ppu.screen.slice(8, 16)), 'la deuxième case de la première rangée').toEqual(Array(8).fill(1));
      ppu.renderLine(8);
      expect(Array.from(ppu.screen.slice(8 * 160, 8 * 160 + 8)), 'la ligne 8 tombe sur la rangée 1 de la carte').toEqual(Array(8).fill(2));
    });

    it('SCX décale l\'échantillonnage : scroll de 3, l\'écran commence au pixel 3 de la tuile', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 0, tuileRampe);
      ppu.write(0xff42 + 1, 3); // SCX (0xFF43)
      ppu.renderLine(0);
      expect(
        Array.from(ppu.screen.slice(0, 5)),
        'la rampe décalée de 3 : on lit (x + SCX) dans le décor',
      ).toEqual([3, 0, 1, 2, 3]);
    });

    it('SCY décale les lignes : scroll de 9, la ligne 0 lit la rangée 1 de la carte, rangée 1 de la tuile', () => {
      const { ram, ppu } = makeRig();
      const rows = Array(8).fill([0, 0, 0, 0, 0, 0, 0, 0]);
      rows[1] = [2, 2, 2, 2, 2, 2, 2, 2]; // 9 mod 8 = rangée 1
      poseTuile(ram, 5, rows);
      ram[0x9800 + 32] = 5; // 9 ÷ 8 = rangée 1 de la carte
      ppu.write(0xff42, 9); // SCY
      ppu.renderLine(0);
      expect(Array.from(ppu.screen.slice(0, 8)), '(y + SCY) : carte ET rangée décalées').toEqual(rows[1]);
    });

    it('adressage SIGNÉ (LCDC bit 4 = 0) : l\'id 0xFF pointe 0x9000 − 16 = 0x8FF0', () => {
      const { ram, ppu } = makeRig();
      ppu.write(0xff40, 0b0000_0001); // bit 4 éteint : mode signé
      // la tuile vit à 0x9000 + sign8(0xFF) × 16 = 0x8FF0
      const rows = Array(8).fill([3, 0, 3, 0, 3, 0, 3, 0]);
      rows.forEach((row, r) => {
        let lo = 0; let hi = 0;
        row.forEach((c, x) => { lo |= (c & 1) << (7 - x); hi |= ((c >> 1) & 1) << (7 - x); });
        ram[0x8ff0 + r * 2] = lo;
        ram[0x8ff0 + r * 2 + 1] = hi;
      });
      ram[0x9800] = 0xff;
      ppu.renderLine(0);
      expect(
        Array.from(ppu.screen.slice(0, 8)),
        'sign8(0xFF) = −1 : la moitié haute des ids vit SOUS 0x9000 — le piège classique',
      ).toEqual(rows[0]);
    });

    it('BG éteint (LCDC bit 0 = 0) : la ligne se peint en blanc', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 0, tuileRampe);
      ppu.renderLine(0); // d'abord peinte...
      ppu.write(0xff40, 0b0001_0000); // ...puis BG coupé
      ppu.renderLine(0);
      expect(ppu.screen.slice(0, 8).every((p) => p === 0), 'décor coupé = blanc').toBe(true);
    });

    it('check() par ligne : une ligne se peint à sa phase de dessin (offset 20)', () => {
      const { ram, machine, ppu } = makeRig();
      poseTuile(ram, 0, Array(8).fill(Array(8).fill(3)));
      ram[0x9800] = 0;
      // au début de la ligne 3 : les lignes 0,1,2 ont passé leur dessin (offset 20),
      // la ligne 3 est à son offset 0 (mode 2) — pas encore dessinée.
      machine.totalCycles = 114 * 3;
      ppu.check();
      expect(ppu.screen[0], 'ligne 0 peinte').toBe(3);
      expect(ppu.screen[160], 'ligne 1 peinte').toBe(3);
      expect(ppu.screen[2 * 160], 'ligne 2 peinte').toBe(3);
      expect(ppu.screen[3 * 160], 'ligne 3 pas encore (son dessin est à l\'offset 20)').toBe(0);
    });
  });

  describe('DMA (0xFF46) : le bouton-copie qui remplit l\'OAM en un geste', () => {
    // Un PPU adossé à une VRAI ram de 64 Ko (le DMA lit la source et écrit
    // l'OAM, les deux par le bus).
    const makeDMA = () => {
      const ram = new Uint8Array(0x10000);
      const machine = {
        totalCycles: 0,
        _if: 0,
        get IF() { return this._if; },
        set IF(v) { this._if = v; },
        memory: { read: (a) => ram[a], write: (a, v) => { ram[a] = v; }, _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; } },
      };
      const PPU = buildPPU(machine);
      return { ram, ppu: new PPU(Fetcher) };
    };

    it('écrire 0xC0 copie 0xC000-0xC09F vers l\'OAM 0xFE00-0xFE9F (160 octets)', () => {
      const { ram, ppu } = makeDMA();
      // on tatoue la source : chaque octet = son rang
      for (let i = 0; i < 0xa0; i++) ram[0xc000 + i] = i;
      ppu.write(0xff46, 0xc0); // « appuie » sur le DMA

      expect(hex(ram[0xfe00], 2), 'premier octet de l\'OAM').toBe('0x00');
      expect(hex(ram[0xfe9f], 2), 'dernier octet (le 160e) — gare à la borne !').toBe('0x9F');
    });

    it('la valeur écrite est l\'octet HAUT de la source : 0xD0 copie depuis 0xD000', () => {
      const { ram, ppu } = makeDMA();
      ram[0xd000] = 0x42;
      ram[0xd09f] = 0x99;
      ppu.write(0xff46, 0xd0);
      expect(hex(ram[0xfe00], 2), 'source 0xD000').toBe('0x42');
      expect(hex(ram[0xfe9f], 2), 'source 0xD09F').toBe('0x99');
    });

    it('EXACTEMENT 160 octets : 0xFEA0 n\'est jamais touché (fin exclusive)', () => {
      const { ram, ppu } = makeDMA();
      ram[0xfea0] = 0x55; // un témoin juste après l'OAM
      for (let i = 0; i < 0xb0; i++) ram[0xc000 + i] = 0xff; // la source déborde exprès
      ppu.write(0xff46, 0xc0);
      expect(
        hex(ram[0xfea0], 2),
        '0xA0 octets = indices 0x00 à 0x9F ; 0xFEA0 est HORS OAM, il doit survivre',
      ).toBe('0x55');
    });

    it('le registre est relisible : read(0xFF46) rend la dernière valeur écrite', () => {
      const { ppu } = makeDMA();
      ppu.write(0xff46, 0xc0);
      expect(hex(ppu.read(0xff46), 2), 'DMA garde sa valeur').toBe('0xC0');
    });
  });

  describe('les sprites : l\'OAM se superpose au décor', () => {
    // Gréement : une vraie ram (VRAM en 0x8000, OAM en 0xFE00), lue par le bus.
    // LCDC de base : écran + BG + SPRITES + adressage 0x8000 (bit 4). Palettes
    // en identité — teinte lue = teinte affichée, pour des tests limpides.
    const makeRig = (lcdc = 0b1001_0011) => {
      const ram = new Uint8Array(0x10000);
      const machine = {
        totalCycles: 0,
        _if: 0,
        get IF() { return this._if; },
        set IF(v) { this._if = v; },
        memory: { read: (a) => ram[a], write: (a, v) => { ram[a] = v; }, _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; } },
      };
      const PPU = buildPPU(machine);
      const ppu = new PPU(Fetcher);
      ppu.write(0xff40, lcdc);
      ppu.write(0xff47, 0b1110_0100); // BGP identité
      ppu.write(0xff48, 0b1110_0100); // OBP0 identité
      ppu.write(0xff49, 0b1110_0100); // OBP1 identité
      return { ram, ppu, machine };
    };

    // 8 rangées de 8 teintes → 16 octets 2bpp à 0x8000 + id*16
    const poseTuile = (ram, id, rows, base = 0x8000) => {
      rows.forEach((row, r) => {
        let lo = 0;
        let hi = 0;
        row.forEach((c, x) => {
          lo |= (c & 1) << (7 - x);
          hi |= ((c >> 1) & 1) << (7 - x);
        });
        ram[base + id * 16 + r * 2] = lo;
        ram[base + id * 16 + r * 2 + 1] = hi;
      });
    };

    // un sprite = 4 octets à 0xFE00 + index*4
    const poseSprite = (ram, index, { y, x, tile, attrs = 0 }) => {
      const o = 0xfe00 + index * 4;
      ram[o] = y;
      ram[o + 1] = x;
      ram[o + 2] = tile;
      ram[o + 3] = attrs;
    };

    const plein = (t) => Array(8).fill(Array(8).fill(t));
    const row = (ppu, line) => Array.from(ppu.screen.slice(line * 160, line * 160 + 160));

    // Chaque sprite rallonge le mode 3 : +6 dots par sprite, plus, pour chaque X
    // UNIQUE, un alignement max(0, 5 - ((X + SCX) mod 8)). Ligne 0 sans sprite : le
    // HBlank tombe au M-cycle 63 (dot 252). Ces tests vérifient qu'il GLISSE de la
    // pénalité. (Base mode 3 = 172 dots ; frontière observée = ceil((252+pénalité)/4).)
    describe('⑨ pénalité de timing : les sprites allongent le mode 3', () => {
      const poserSprites = (ram, n, x) => {
        for (let i = 0; i < n; i++) poseSprite(ram, i, { y: 16, x, tile: 0 }); // Y=16 → ligne 0
      };

      it('10 sprites à X=8 (mod 8 = 0, alignement max) : +6×10 + 5 = 65 dots', () => {
        const { ram, ppu, machine } = makeRig();
        poserSprites(ram, 10, 8);
        // mode 3 finit au dot 252 + 65 = 317 → ceil(317/4) = M-cycle 80
        machine.totalCycles = 79; ppu.check();
        expect(ppu.mode, 'M-cycle 79 : encore le dessin (allongé par 10 sprites)').toBe(3);
        machine.totalCycles = 80; ppu.check();
        expect(ppu.mode, 'M-cycle 80 : enfin le HBlank').toBe(0);
      });

      it('10 sprites à X=13 (mod 8 = 5, alignement nul) : +60 dots seulement', () => {
        const { ram, ppu, machine } = makeRig();
        poserSprites(ram, 10, 13);
        // mode 3 finit au dot 252 + 60 = 312 → 312/4 = M-cycle 78 (pile)
        machine.totalCycles = 77; ppu.check();
        expect(ppu.mode, 'M-cycle 77 : encore le dessin').toBe(3);
        machine.totalCycles = 78; ppu.check();
        expect(ppu.mode, 'M-cycle 78 : HBlank (5 dots plus tôt qu\'à X=8)').toBe(0);
      });
    });

    describe('① un sprite opaque sur le décor', () => {
      it('Y+16, X+8 : le sprite en (0,0) écran occupe les pixels 0-7 de la ligne 0', () => {
        const { ram, ppu } = makeRig();
        poseTuile(ram, 1, plein(2));
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1 }); // Y=16 → écran 0 ; X=8 → écran 0
        ppu.renderLine(0);
        const l = row(ppu, 0);
        expect(l.slice(0, 8), 'les 8 pixels du sprite').toEqual(Array(8).fill(2));
        expect(l[8], 'juste après le sprite : le décor (0)').toBe(0);
      });

      it('la position Y sélectionne la ligne : Y=32 apparaît en ligne 16, pas en ligne 0', () => {
        const { ram, ppu } = makeRig();
        poseTuile(ram, 1, plein(3));
        poseSprite(ram, 0, { y: 32, x: 8, tile: 1 }); // Y=32 → écran 16
        ppu.renderLine(0);
        expect(row(ppu, 0)[0], 'ligne 0 : le sprite n\'est pas là').toBe(0);
        ppu.renderLine(16);
        expect(row(ppu, 16)[0], 'ligne 16 : le voilà').toBe(3);
      });

      it('LCDC bit 1 éteint : aucun sprite n\'est dessiné', () => {
        const { ram, ppu } = makeRig(0b1001_0001); // bit 1 (sprites) éteint
        poseTuile(ram, 1, plein(3));
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1 });
        ppu.renderLine(0);
        expect(row(ppu, 0)[0], 'sprites désactivés').toBe(0);
      });

      it('X clipping : un sprite en X=4 déborde à gauche, seule sa moitié droite entre', () => {
        const { ram, ppu } = makeRig();
        // cols 4,5,6 = teintes 1,2,3 ; le reste 0 (transparent)
        poseTuile(ram, 1, Array(8).fill([0, 0, 0, 0, 1, 2, 3, 0]));
        poseSprite(ram, 0, { y: 16, x: 4, tile: 1 }); // X=4 → écran -4 : cols 0-3 hors champ
        ppu.renderLine(0);
        const l = row(ppu, 0);
        expect([l[0], l[1], l[2]], 'les cols 4,5,6 atterrissent en écran 0,1,2').toEqual([1, 2, 3]);
      });
    });

    describe('② la couleur 0 est transparente — le décor transparaît', () => {
      it('les pixels de teinte 0 du sprite laissent voir le BG dessous', () => {
        const { ram, ppu } = makeRig();
        poseTuile(ram, 0, plein(1)); // le décor : tuile 0 = teinte 1 partout
        // sprite : moitié gauche transparente (0), moitié droite teinte 3
        poseTuile(ram, 1, Array(8).fill([0, 0, 0, 0, 3, 3, 3, 3]));
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1 });
        ppu.renderLine(0);
        const l = row(ppu, 0);
        expect(l.slice(0, 4), 'teinte 0 = transparent = le décor (1)').toEqual(Array(4).fill(1));
        expect(l.slice(4, 8), 'teinte 3 = opaque').toEqual(Array(4).fill(3));
      });

      it('la couleur 0 reste transparente MÊME si la palette la mappe non-nulle', () => {
        const { ram, ppu } = makeRig();
        poseTuile(ram, 0, plein(2)); // décor teinte 2
        poseTuile(ram, 1, plein(0)); // sprite : tout en teinte 0
        ppu.write(0xff48, 0b1110_0111); // OBP0 : index 0 → 3 (mais ça ne doit RIEN changer)
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1 });
        ppu.renderLine(0);
        expect(
          row(ppu, 0).slice(0, 8),
          'la teinte 0 des sprites est transparente AVANT la palette',
        ).toEqual(Array(8).fill(2));
      });
    });

    describe('③ les flips', () => {
      it('flip X (bit 5) : la rangée est lue à l\'envers', () => {
        const { ram, ppu } = makeRig();
        poseTuile(ram, 1, Array(8).fill([3, 0, 0, 0, 0, 0, 0, 1]));
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1, attrs: 0b0010_0000 });
        const l = (ppu.renderLine(0), row(ppu, 0));
        expect(l[0], 'écran 0 lit la col 7 (=1)').toBe(1);
        expect(l[7], 'écran 7 lit la col 0 (=3)').toBe(3);
      });

      it('flip Y (bit 6) : les rangées sont empilées à l\'envers', () => {
        const { ram, ppu } = makeRig();
        const rows = Array.from({ length: 8 }, () => [0, 0, 0, 0, 0, 0, 0, 0]);
        rows[0] = Array(8).fill(1);
        rows[7] = Array(8).fill(3);
        poseTuile(ram, 1, rows);
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1, attrs: 0b0100_0000 });
        ppu.renderLine(0);
        expect(row(ppu, 0)[0], 'ligne 0 lit la rangée 7 (=3) à cause du flip Y').toBe(3);
      });
    });

    describe('④ les palettes OBP0 / OBP1', () => {
      it('bit 4 choisit la palette : deux sprites de même teinte, deux couleurs', () => {
        const { ram, ppu } = makeRig();
        poseTuile(ram, 1, plein(1)); // teinte 1
        ppu.write(0xff48, 0b0000_1100); // OBP0 : index 1 → 3
        ppu.write(0xff49, 0b0000_0100); // OBP1 : index 1 → 1
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1, attrs: 0b0000_0000 }); // OBP0
        poseSprite(ram, 1, { y: 16, x: 16, tile: 1, attrs: 0b0001_0000 }); // OBP1
        ppu.renderLine(0);
        const l = row(ppu, 0);
        expect(l[0], 'sprite 0 via OBP0 : teinte 1 → 3').toBe(3);
        expect(l[8], 'sprite 1 via OBP1 : teinte 1 → 1').toBe(1);
      });
    });

    describe('⑤ la priorité entre sprites', () => {
      it('X le plus petit gagne le pixel partagé', () => {
        const { ram, ppu } = makeRig();
        poseTuile(ram, 1, plein(1)); // sprite A = teinte 1
        poseTuile(ram, 2, plein(3)); // sprite B = teinte 3
        poseSprite(ram, 0, { y: 16, x: 12, tile: 1 }); // A : écran 4-11
        poseSprite(ram, 1, { y: 16, x: 8, tile: 2 });  // B : écran 0-7 (X plus petit)
        ppu.renderLine(0);
        expect(row(ppu, 0)[5], 'zone partagée : B gagne (X=8 < X=12)').toBe(3);
      });

      it('X égal : l\'index OAM le plus BAS gagne', () => {
        const { ram, ppu } = makeRig();
        poseTuile(ram, 1, plein(1));
        poseTuile(ram, 2, plein(3));
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1 }); // index 0
        poseSprite(ram, 1, { y: 16, x: 8, tile: 2 }); // index 1, même X
        ppu.renderLine(0);
        expect(row(ppu, 0)[0], 'égalité tranchée par l\'index : le 0 gagne (teinte 1)').toBe(1);
      });
    });

    describe('⑥ la limite de 10 sprites par ligne', () => {
      it('11 sprites sur la même ligne : le 11e (ordre OAM) est ABANDONNÉ', () => {
        const { ram, ppu } = makeRig();
        poseTuile(ram, 1, plein(3));
        // 11 sprites côte à côte, index 0..10, chacun ses 8 colonnes
        for (let i = 0; i <= 10; i++) {
          poseSprite(ram, i, { y: 16, x: 8 + i * 8, tile: 1 });
        }
        ppu.renderLine(0);
        const l = row(ppu, 0);
        expect(l[0], 'sprite 0 : dessiné').toBe(3);
        expect(l[72], 'sprite 9 : dessiné (le 10e)').toBe(3);
        expect(l[80], 'sprite 10 : le 11e en ordre OAM, laissé de côté').toBe(0);
      });
    });

    describe('⑦ la priorité sur le décor (bit 7)', () => {
      it('bit 7 : le sprite passe DERRIÈRE les couleurs BG 1-3, mais devant la couleur 0', () => {
        const { ram, ppu } = makeRig();
        // décor : moitié gauche teinte 2 (non-nulle), moitié droite teinte 0
        poseTuile(ram, 0, Array(8).fill([2, 2, 2, 2, 0, 0, 0, 0]));
        poseTuile(ram, 1, plein(3)); // sprite teinte 3
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1, attrs: 0b1000_0000 }); // priorité BG
        ppu.renderLine(0);
        const l = row(ppu, 0);
        expect(l.slice(0, 4), 'BG non-nul (2) → le sprite est caché').toEqual(Array(4).fill(2));
        expect(l.slice(4, 8), 'BG nul (0) → le sprite ressort (3)').toEqual(Array(4).fill(3));
      });
    });

    describe('⑧ le mode 8×16 (LCDC bit 2)', () => {
      it('un sprite de 16 de haut : tuile haute puis tuile basse (id&0xFE / id|1)', () => {
        const { ram, ppu } = makeRig(0b1001_0111); // + bit 2 : sprites 8×16
        poseTuile(ram, 0, plein(1)); // tuile HAUTE = teinte 1
        poseTuile(ram, 1, plein(3)); // tuile BASSE = teinte 3
        poseSprite(ram, 0, { y: 16, x: 8, tile: 0 }); // couvre les lignes 0..15
        ppu.renderLine(0);
        expect(row(ppu, 0)[0], 'ligne 0 = rangée 0 de la tuile HAUTE (1)').toBe(1);
        ppu.renderLine(8);
        expect(row(ppu, 8)[0], 'ligne 8 = rangée 0 de la tuile BASSE (3)').toBe(3);
      });

      it('en 8×16, le bit 0 du n° de tuile est ignoré : tile 1 = tile 0 pour le haut', () => {
        const { ram, ppu } = makeRig(0b1001_0111);
        poseTuile(ram, 0, plein(1));
        poseTuile(ram, 1, plein(3));
        poseSprite(ram, 0, { y: 16, x: 8, tile: 1 }); // 1 & 0xFE = 0 pour le haut
        ppu.renderLine(0);
        expect(row(ppu, 0)[0], 'la tuile haute est 0, pas 1').toBe(1);
      });
    });
  });

  describe('la fenêtre : un calque opaque qui recouvre le décor', () => {
    // LCDC : écran + BG + FENÊTRE (bit 5) + adressage 0x8000 (bit 4)
    //      + carte fenêtre = 0x9C00 (bit 6 = 1), DISTINCTE de la carte BG
    //        (0x9800) — sans quoi décor et fenêtre liraient les mêmes cases.
    const makeRig = (lcdc = 0b1111_0001) => {
      const ram = new Uint8Array(0x10000);
      const machine = {
        totalCycles: 0,
        _if: 0,
        get IF() { return this._if; },
        set IF(v) { this._if = v; },
        memory: { read: (a) => ram[a], write: (a, v) => { ram[a] = v; }, _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; } },
      };
      const PPU = buildPPU(machine);
      const ppu = new PPU(Fetcher);
      ppu.write(0xff40, lcdc);
      ppu.write(0xff47, 0b1110_0100); // BGP identité (la fenêtre l'utilise aussi)
      return { ram, ppu };
    };

    const poseTuile = (ram, id, rows, base = 0x8000) => {
      rows.forEach((row, r) => {
        let lo = 0;
        let hi = 0;
        row.forEach((c, x) => {
          lo |= (c & 1) << (7 - x);
          hi |= ((c >> 1) & 1) << (7 - x);
        });
        ram[base + id * 16 + r * 2] = lo;
        ram[base + id * 16 + r * 2 + 1] = hi;
      });
    };
    const plein = (t) => Array(8).fill(Array(8).fill(t));
    const row = (ppu, line) => Array.from(ppu.screen.slice(line * 160, line * 160 + 160));

    // un décor de teinte 1 partout (tuile 1 en case 0 de la carte BG 0x9800)
    const poseDecor = (ram, t = 1) => {
      poseTuile(ram, 1, plein(t));
      for (let i = 0; i < 32 * 32; i++) ram[0x9800 + i] = 1;
    };
    // la carte fenêtre (0x9C00 par défaut, distincte du décor) pointe partout vers `id`
    const poseCarteFenetre = (ram, id, base = 0x9c00) => {
      for (let i = 0; i < 32 * 32; i++) ram[base + i] = id;
    };

    describe('① la fenêtre remplace le décor là où elle est active', () => {
      it('WX=7, WY=0 : la fenêtre couvre toute la ligne et écrase le BG', () => {
        const { ram, ppu } = makeRig();
        poseDecor(ram, 1);              // BG teinte 1
        poseTuile(ram, 2, plein(3));    // fenêtre teinte 3
        poseCarteFenetre(ram, 2);
        ppu.write(0xff4a, 0);           // WY=0
        ppu.write(0xff4b, 7);           // WX=7 → écran x=0
        ppu.renderLine(0);
        expect(row(ppu, 0).slice(0, 8), 'le décor est intégralement recouvert').toEqual(Array(8).fill(3));
      });

      it('WX décale de 7 : WX=8 laisse le pixel 0 au décor, la fenêtre commence en x=1', () => {
        const { ram, ppu } = makeRig();
        poseDecor(ram, 1);
        poseTuile(ram, 2, plein(3));
        poseCarteFenetre(ram, 2);
        ppu.write(0xff4a, 0);
        ppu.write(0xff4b, 8);           // WX=8 → écran x=1
        ppu.renderLine(0);
        const l = row(ppu, 0);
        expect(l[0], 'x=0 : encore le décor (1)').toBe(1);
        expect(l[1], 'x=1 : la fenêtre commence (3)').toBe(3);
      });

      it('WY : rien avant la ligne WY', () => {
        const { ram, ppu } = makeRig();
        poseDecor(ram, 1);
        poseTuile(ram, 2, plein(3));
        poseCarteFenetre(ram, 2);
        ppu.write(0xff4a, 5);           // WY=5
        ppu.write(0xff4b, 7);
        ppu.renderLine(4);
        expect(row(ppu, 4)[0], 'ligne 4 < WY : pas de fenêtre').toBe(1);
        ppu.renderLine(5);
        expect(row(ppu, 5)[0], 'ligne 5 = WY : la fenêtre apparaît').toBe(3);
      });

      it('LCDC bit 5 éteint : pas de fenêtre du tout', () => {
        const { ram, ppu } = makeRig(0b1001_0001); // bit 5 éteint
        poseDecor(ram, 1);
        poseTuile(ram, 2, plein(3));
        poseCarteFenetre(ram, 2);
        ppu.write(0xff4a, 0);
        ppu.write(0xff4b, 7);
        ppu.renderLine(0);
        expect(row(ppu, 0)[0], 'fenêtre désactivée').toBe(1);
      });
    });

    describe('② la fenêtre ignore SCX / SCY', () => {
      it('le scroll ne déplace pas la fenêtre', () => {
        const { ram, ppu } = makeRig();
        poseDecor(ram, 1);
        // tuile fenêtre : rangée 0 = teinte 3, le reste 0
        const rows = Array.from({ length: 8 }, () => Array(8).fill(0));
        rows[0] = Array(8).fill(3);
        poseTuile(ram, 2, rows);
        poseCarteFenetre(ram, 2);
        ppu.write(0xff42, 50);          // SCY=50 : ne doit PAS décaler la fenêtre
        ppu.write(0xff43, 50);          // SCX=50 : idem
        ppu.write(0xff4a, 0);
        ppu.write(0xff4b, 7);
        ppu.renderLine(0);
        expect(row(ppu, 0)[0], 'la fenêtre lit sa rangée 0, indifférente au scroll').toBe(3);
      });
    });

    describe('③ la carte de la fenêtre (LCDC bit 6, distinct du BG)', () => {
      it('bit 6 choisit 0x9C00 au lieu de 0x9800', () => {
        const { ram, ppu } = makeRig(0b1111_0001); // + bit 6 : carte fenêtre = 0x9C00
        poseDecor(ram, 1);
        poseTuile(ram, 4, plein(2));
        poseCarteFenetre(ram, 4, 0x9c00); // la carte HAUTE
        ppu.write(0xff4a, 0);
        ppu.write(0xff4b, 7);
        ppu.renderLine(0);
        expect(row(ppu, 0)[0], 'la fenêtre lit sa carte 0x9C00').toBe(2);
      });
    });

    describe('④ le compteur de ligne INTERNE — pas (line − WY)', () => {
      // Une tuile fenêtre dont les rangées diffèrent : rangée r = teinte (r % 4).
      const poseTuileEscalier = (ram, id = 2) => {
        const rows = Array.from({ length: 8 }, (_, r) => Array(8).fill([0, 1, 2, 3][r % 4]));
        poseTuile(ram, id, rows);
        poseCarteFenetre(ram, id);
      };

      it('le compteur n\'avance QUE sur les lignes où la fenêtre est dessinée', () => {
        const { ram, ppu } = makeRig();
        poseDecor(ram, 3); // BG teinte 3, bien visible quand la fenêtre est coupée
        poseTuileEscalier(ram, 2);
        ppu.write(0xff4a, 0); // WY=0
        ppu.write(0xff4b, 7); // WX=7

        ppu.renderLine(0); // fenêtre dessinée : compteur 0 → rangée 0 (teinte 0 = transparente ? non, opaque : 0)
        // rangée 0 de l'escalier = teinte 0 → BGP identité → 0 (la fenêtre EST opaque, elle écrit 0)
        expect(row(ppu, 0)[0], 'ligne 0 : rangée fenêtre 0').toBe(0);

        // on COUPE la fenêtre (bit 5 éteint, bit 6 CONSERVÉ), on rend la ligne 1 :
        // le compteur ne doit PAS avancer
        ppu.write(0xff40, 0b1101_0001);
        ppu.renderLine(1);
        expect(row(ppu, 1)[0], 'ligne 1 : fenêtre coupée, le décor (3)').toBe(3);

        // on RALLUME, ligne 2 : le compteur vaut TOUJOURS 1 (pas 2 !)
        ppu.write(0xff40, 0b1111_0001);
        ppu.renderLine(2);
        expect(
          row(ppu, 2)[0],
          'rangée 1 (compteur interne), PAS rangée 2 : la ligne coupée n\'a rien compté',
        ).toBe(1);
      });

      it('le compteur n\'avance PAS tant que la fenêtre est hors-écran (WX > 166) — le fix dmg-acid2', () => {
        const { ram, ppu } = makeRig();
        poseDecor(ram, 3); // BG teinte 3 quand la fenêtre ne dessine pas
        poseTuileEscalier(ram, 2);
        ppu.write(0xff4a, 0);   // WY=0
        ppu.write(0xff4b, 240); // WX=240 → fenêtre HORS écran (startX=233 > 159)

        ppu.renderLine(0); // fenêtre activée + line>=WY, mais INVISIBLE : le compteur ne doit pas bouger
        ppu.renderLine(1);
        expect(row(ppu, 0)[0], 'hors écran : le décor reste (3)').toBe(3);

        // la fenêtre entre à l'écran : sa PREMIÈRE ligne visible doit être la rangée 0
        ppu.write(0xff4b, 7); // WX=7 → visible
        ppu.renderLine(2);
        expect(
          row(ppu, 2)[0],
          'rangée 0 (compteur=0) : les lignes hors-écran n\'ont RIEN compté — sinon rangée 2',
        ).toBe(0);
      });

      it('le compteur se remet à zéro au début de chaque trame (ligne 0)', () => {
        const { ram, ppu } = makeRig();
        poseDecor(ram, 3);
        poseTuileEscalier(ram, 2);
        ppu.write(0xff4a, 0);
        ppu.write(0xff4b, 7);

        ppu.renderLine(0);
        ppu.renderLine(1);
        ppu.renderLine(2); // compteur monté à 3
        ppu.renderLine(0); // NOUVELLE trame : reset
        expect(row(ppu, 0)[0], 'rangée 0 de nouveau : le compteur est reparti de zéro').toBe(0);
      });
    });
  });

  describe('STAT (0xFF41) + LYC : le registre d\'état et ses interruptions', () => {
    // Rig avec bus muet (check() peint des lignes vierges) et IF espionné.
    const makeRig = () => {
      const machine = {
        totalCycles: 0,
        _if: 0,
        get IF() { return this._if; },
        set IF(v) { this._if = v; },
        memory: { read: () => 0, write: () => {}, _read: () => 0, _write: () => {} },
      };
      const PPU = buildPPU(machine);
      const ppu = new PPU(Fetcher);
      return { machine, ppu };
    };
    // amène l'horloge au début de la ligne `n` ET pilote le PPU jusque-là :
    // LY lit `line`, que seul check() fait avancer.
    const versLigne = (machine, ppu, n) => { machine.totalCycles = 114 * n; ppu.check(); };

    describe('le registre : bits bas calculés, bits hauts écrits', () => {
      it('bit 7 lit toujours 1', () => {
        const { ppu } = makeRig();
        ppu.write(0xff41, 0x00);
        expect(ppu.read(0xff41) & 0x80, 'le bit 7 est câblé à 1').toBe(0x80);
      });

      it('les bits 3-6 (autorisations) sont écrits et relus', () => {
        const { ppu } = makeRig();
        ppu.write(0xff41, 0b0111_1000); // les 4 autorisations
        expect(ppu.read(0xff41) & 0b0111_1000, 'bits 3-6 conservés').toBe(0b0111_1000);
      });

      it('les bits 0-2 NE sont PAS écrits : ils restent calculés', () => {
        const { machine, ppu } = makeRig();
        machine.totalCycles = 0; // LY=0
        ppu.write(0xff45, 99); // LYC=99, donc PAS de coïncidence
        ppu.write(0xff41, 0b0000_0111); // on tente d'écrire les bits bas...
        expect(ppu.read(0xff41) & 0b0000_0100, 'bit 2 reflète LY==LYC (faux), pas l\'écriture').toBe(0);
      });
    });

    describe('bit 2 : le drapeau de coïncidence LY == LYC', () => {
      it('levé quand LY atteint LYC, baissé sinon', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff45, 5); // LYC=5
        versLigne(machine, ppu, 5);
        expect(ppu.read(0xff41) & 0b100, 'LY=5 == LYC=5').toBe(0b100);
        versLigne(machine, ppu, 6);
        expect(ppu.read(0xff41) & 0b100, 'LY=6 != LYC=5').toBe(0);
      });
    });

    describe('bits 0-1 : le mode du PPU, selon la PHASE de la scanline', () => {
      it('offset 0 → mode 2 (OAM), +20 → mode 3 (dessin), +63 → mode 0 (HBlank), VBlank → mode 1', () => {
        const { machine, ppu } = makeRig();
        const modeAt = (cyc) => { machine.totalCycles = cyc; ppu.check(); return ppu.read(0xff41) & 0b11; };
        expect(modeAt(114 * 50 + 0), 'début de ligne : scan OAM').toBe(2);
        expect(modeAt(114 * 50 + 25), 'après 20 cycles : dessin').toBe(3);
        expect(modeAt(114 * 50 + 70), 'après 63 cycles : HBlank').toBe(0);
        expect(modeAt(114 * 145 + 5), 'ligne 145 : VBlank').toBe(1);
      });
    });

    describe('les interruptions STAT (IF bit 1) — déclenchées par check()', () => {
      const IF_STAT = 0b0000_0010;

      it('coïncidence LYC (bit 6) : IF bit 1 quand LY atteint LYC', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff45, 40);        // LYC=40
        ppu.write(0xff41, 0b0100_0000); // SEULE la coïncidence est armée (bit 6)
        machine.totalCycles = 114 * 41; // check traverse la ligne 40
        ppu.check();
        expect(machine.IF & IF_STAT, 'la coïncidence a frappé').toBe(IF_STAT);
      });

      it('coïncidence NON armée (bit 6 éteint) : aucune frappe', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff45, 40);
        ppu.write(0xff41, 0b0000_0000);
        machine.totalCycles = 114 * 41;
        ppu.check();
        expect(machine.IF & IF_STAT, 'source désarmée = silence').toBe(0);
      });

      it('VBlank via STAT (bit 4) : frappe à la ligne 144', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0b0001_0000); // seul bit 4 (mode 1)
        machine.totalCycles = 114 * 145;
        ppu.check();
        expect(machine.IF & IF_STAT, 'l\'entrée en VBlank arme aussi STAT').toBe(IF_STAT);
      });

      it('OAM via STAT (bit 5) : frappe sur les lignes visibles', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0b0010_0000); // seul bit 5 (mode 2)
        machine.totalCycles = 114 * 10;
        ppu.check();
        expect(machine.IF & IF_STAT, 'chaque ligne visible arme le mode OAM').toBe(IF_STAT);
      });

      it('HBlank via STAT (bit 3) : frappe sur les lignes visibles', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0b0000_1000); // seul bit 3 (mode 0)
        machine.totalCycles = 114 * 10;
        ppu.check();
        expect(machine.IF & IF_STAT, 'chaque ligne visible arme le mode HBlank').toBe(IF_STAT);
      });

      it('STAT (bit 1) est distinct du VBlank (bit 0) : la ligne 144 lève les DEUX', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0b0001_0000); // VBlank-via-STAT armé
        machine.totalCycles = 114 * 145;
        ppu.check();
        expect(machine.IF & 0b1, 'le VBlank classique, bit 0').toBe(0b1);
        expect(machine.IF & 0b10, 'le STAT, bit 1, en plus').toBe(0b10);
      });
    });

    // Le vrai matériel n'a qu'UNE ligne d'interruption STAT : les 4 sources y sont
    // OR'ées, et l'IRQ ne part qu'au FRONT MONTANT (0 -> 1). Tant que la ligne
    // reste haute, plus rien ne part — c'est le « STAT blocking ». On teste ici ce
    // que le modèle « frappe à chaque condition » ne sait pas faire.
    describe('une seule ligne STAT, à front montant (le « STAT blocking »)', () => {
      const IF_STAT = 0b0000_0010;

      it('blocking : la coïncidence LYC tient la ligne haute, le HBlank ne refrappe pas', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff45, 40);          // LYC=40
        ppu.write(0xff41, 0b0100_1000); // bit 6 (LYC) + bit 3 (HBlank) armés
        machine.totalCycles = 114 * 40; ppu.check(); // début ligne 40 : la coïncidence LÈVE la ligne
        machine.IF = 0;                 // on repart propre, APRÈS ce front
        machine.totalCycles = 114 * 40 + 100; ppu.check(); // même ligne 40, on entre en HBlank
        expect(machine.IF & IF_STAT, 'ligne déjà haute (LYC) : le HBlank est BLOQUÉ').toBe(0);
      });

      it('écrire une autorisation STAT pendant que sa condition est active lève la ligne', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0);           // rien d'armé -> ligne basse
        machine.totalCycles = 114 * 5 + 100; ppu.check(); // ligne 5, en plein HBlank (mode 0)
        machine.IF = 0;
        ppu.write(0xff41, 0b0000_1000); // on ARME le HBlank ALORS QUE le mode 0 est déjà là
        expect(machine.IF & IF_STAT, 'armer pendant la condition = front montant').toBe(IF_STAT);
      });

      it('écrire LYC pour créer la coïncidence lève la ligne (le fix stat_lyc_onoff)', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0b0100_0000); // bit 6 (LYC) armé
        ppu.write(0xff45, 99);          // LYC=99 : pas de coïncidence
        machine.totalCycles = 114 * 5; ppu.check(); // ligne 5
        machine.IF = 0;
        ppu.write(0xff45, 5);           // LYC recalé sur LY=5 -> coïncidence -> front
        expect(machine.IF & IF_STAT, 'LYC == LY subitement = front montant').toBe(IF_STAT);
      });

      it('une source qui reste active ne refrappe pas (VBlank tenu sur plusieurs lignes)', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0b0001_0000); // bit 4 (VBlank-STAT)
        machine.totalCycles = 114 * 144; ppu.check(); // entrée VBlank : UN front
        machine.IF = 0;
        machine.totalCycles = 114 * 150; ppu.check(); // 6 lignes plus loin, toujours VBlank
        expect(machine.IF & IF_STAT, 'la ligne reste haute tout le VBlank : aucune re-frappe').toBe(0);
      });

      // Quirk DMG (vblank_stat_intr) : à l'entrée du VBlank (ligne 144), si le bit 5
      // (OAM) est armé, la ligne STAT monte AUSSI — au même cycle que le VBlank,
      // alors même que le mode est déjà 1. (Sur CGB ça décale d'un cycle.)
      it('quirk : à la ligne 144, l\'OAM (bit 5) frappe au même instant que le VBlank', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0b0010_0000); // bit 5 (OAM) armé
        machine.totalCycles = 114 * 143 + 100; ppu.check(); // ligne 143, mode 0 : l'OAM est retombé
        machine.IF = 0;
        machine.totalCycles = 114 * 144; ppu.check(); // pile l'entrée en VBlank
        expect(machine.IF & IF_STAT, 'l\'OAM frappe AUSSI à la ligne 144 (malgré le mode 1)').toBe(IF_STAT);
        expect(machine.IF & 0b00001, 'et le VBlank, au même instant').toBe(0b00001);
      });
    });

    // Mode 3 (dessin) n'est PAS fixe : le PPU jette les premiers `SCX & 7` pixels,
    // ce qui rallonge le mode 3 d'autant — donc le HBlank (mode 0) glisse d'autant.
    // La ligne reste 456 dots (mode 0 rétrécit pour compenser).
    describe('mode 3 variable : SCX & 7 rallonge le dessin (le HBlank glisse)', () => {
      it('SCX & 7 = 0 : le HBlank (mode 0) démarre au M-cycle 63', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff43, 0); // SCX = 0 : mode 3 = 172 dots (base)
        machine.totalCycles = 62; ppu.check();
        expect(ppu.mode, 'M-cycle 62 : encore le dessin').toBe(3);
        machine.totalCycles = 63; ppu.check();
        expect(ppu.mode, 'M-cycle 63 : HBlank').toBe(0);
      });

      it('SCX & 7 = 7 : mode 3 rallongé de 7 dots, le HBlank ne vient qu\'au M-cycle 65', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff43, 7); // SCX & 7 = 7 → +7 dots sur le mode 3
        machine.totalCycles = 64; ppu.check();
        expect(ppu.mode, 'M-cycle 64 : ENCORE le dessin (allongé)').toBe(3);
        machine.totalCycles = 65; ppu.check();
        expect(ppu.mode, 'M-cycle 65 : enfin le HBlank').toBe(0);
      });
    });

    // Le bit 2 (LY==LYC) est un VERROU, pas un calcul live : sa comparaison a une
    // horloge qui s'ARRÊTE quand le PPU est éteint. Éteint, le bit est gelé à sa
    // dernière valeur (écrire LYC n'y change rien) ; rallumer redémarre l'horloge
    // et recompare à LY=0. (le fix stat_lyc_onoff)
    describe('coïncidence LY=LYC : un verrou gelé quand le PPU est éteint', () => {
      const OFF = 0b0001_0001;
      const ON = 0b1001_0001;

      it('gelé à l\'extinction : le bit reste à sa dernière valeur (pas remis à 0)', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff45, 5); // LYC=5
        machine.totalCycles = 114 * 5; ppu.check(); // LY=5 → coïncidence
        expect(ppu.read(0xff41) & 0b100, 'LY=5 == LYC=5 allumé').toBe(0b100);
        ppu.write(0xff40, OFF); // éteindre
        expect(ppu.read(0xff41) & 0b100, 'éteint : le bit est RETENU, pas recalculé à LY=0').toBe(0b100);
      });

      it('écrire LYC pendant off n\'a aucun effet (horloge de comparaison arrêtée)', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff45, 5);
        machine.totalCycles = 114 * 5; ppu.check();
        ppu.write(0xff40, OFF);
        ppu.write(0xff45, 99); // changer LYC pendant que c'est éteint
        expect(ppu.read(0xff41) & 0b100, 'horloge arrêtée : le bit reste gelé').toBe(0b100);
      });

      it('rallumer recompare à LY=0 : le bit retombe si LYC != 0', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff45, 5);
        machine.totalCycles = 114 * 5; ppu.check();
        ppu.write(0xff40, OFF); // gelé à 1
        ppu.write(0xff40, ON); // rallumer → recompare LY=0 vs LYC=5
        expect(ppu.read(0xff41) & 0b100, 'LY=0 != LYC=5 : la coïncidence tombe').toBe(0);
      });

      it('rallumage, coïncidence qui MONTE (0→1) : le front frappe STAT', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0b0100_0000); // interruption LYC armée (bit 6)
        ppu.write(0xff45, 99);          // LYC=99
        machine.totalCycles = 114 * 5; ppu.check(); // LY=5 != 99 → coïncidence 0
        ppu.write(0xff40, OFF);         // gelé à 0
        ppu.write(0xff45, 0);           // LYC=0 (sans effet pendant off)
        machine.IF = 0;
        ppu.write(0xff40, ON);          // rallumer : LY=0 == LYC=0 → coïncidence MONTE 0→1
        expect(ppu.read(0xff41) & 0b100, 'coïncidence remonte').toBe(0b100);
        expect(machine.IF & 0b10, 'front 0→1 → STAT frappe').toBe(0b10);
      });

      it('rallumage, coïncidence qui RESTE à 1 : pas de nouvelle frappe (drapeau inchangé)', () => {
        const { machine, ppu } = makeRig();
        ppu.write(0xff41, 0b0100_0000); // bit 6 armé
        ppu.write(0xff45, 5);           // LYC=5
        machine.totalCycles = 114 * 5; ppu.check(); // LY=5 == 5 → coïncidence 1
        ppu.write(0xff40, OFF);         // gelé à 1
        ppu.write(0xff45, 0);           // LYC=0 (sans effet)
        machine.IF = 0;
        ppu.write(0xff40, ON);          // rallumer : LY=0 == LYC=0 → coïncidence RESTE 1 (pas de front)
        expect(ppu.read(0xff41) & 0b100, 'coïncidence toujours à 1').toBe(0b100);
        expect(machine.IF & 0b10, 'le drapeau ne monte pas → AUCUNE frappe').toBe(0);
      });

      it('éteint : les bits de mode (0-1) lisent 0, pas le mode figé', () => {
        const { machine, ppu } = makeRig();
        machine.totalCycles = 114 * 145; ppu.check(); // entrer dans le VBlank (mode 1)
        expect(ppu.read(0xff41) & 0b11, 'allumé, en VBlank : mode 1').toBe(1);
        ppu.write(0xff40, OFF); // éteindre pendant le mode 1
        expect(ppu.read(0xff41) & 0b11, 'éteint : le mode lu est 0, pas le mode figé (1)').toBe(0);
      });
    });
  });

  describe('la machine à phases : le dessin a lieu APRÈS l\'interruption STAT — LE fix', () => {
    // Bus adossé à une vraie ram. Le décor est agencé pour que le pixel 0 de
    // l'écran dépende de SCX : case 0 de la carte = teinte 1, case 1 = teinte 2.
    // Ainsi SCX=0 → pixel 0 lit la case 0 (teinte 1) ; SCX=8 → case 1 (teinte 2).
    const makeRig = () => {
      const ram = new Uint8Array(0x10000);
      const machine = {
        totalCycles: 0,
        _if: 0,
        get IF() { return this._if; },
        set IF(v) { this._if = v; },
        memory: { read: (a) => ram[a], write: (a, v) => { ram[a] = v; }, _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; } },
      };
      const PPU = buildPPU(machine);
      const ppu = new PPU(Fetcher);
      ppu.write(0xff40, 0b1001_0001); // écran + BG + adressage 0x8000
      ppu.write(0xff47, 0b1110_0100); // BGP identité
      // tuile 1 = teinte 1 partout, tuile 2 = teinte 2 partout
      for (let r = 0; r < 8; r++) { ram[0x8010 + r * 2] = 0xff; ram[0x8010 + r * 2 + 1] = 0x00; } // tuile1=1
      for (let r = 0; r < 8; r++) { ram[0x8020 + r * 2] = 0x00; ram[0x8020 + r * 2 + 1] = 0xff; } // tuile2=2
      // toute la carte : colonne 0 → tuile 1, colonne 1 → tuile 2 (à chaque rangée,
      // car la ligne testée lit la rangée line/8 de la carte, pas la rangée 0)
      for (let row = 0; row < 32; row++) { ram[0x9800 + row * 32] = 1; ram[0x9800 + row * 32 + 1] = 2; }
      return { ram, machine, ppu };
    };

    it('un registre changé entre l\'interruption (offset 0) et le dessin (offset 20) affecte CETTE ligne', () => {
      const { machine, ppu } = makeRig();
      const N = 30;
      ppu.write(0xff45, N);        // LYC = 30
      ppu.write(0xff41, 0b0100_0000); // interruption de coïncidence armée (bit 6)
      ppu.write(0xff43, 0);        // SCX = 0

      // on avance PILE au début de la ligne 30 (offset 0, mode 2) : l'interruption
      // STAT part, mais la ligne n'est PAS encore dessinée (dessin à l'offset 20).
      machine.totalCycles = 114 * N;
      ppu.check();
      expect(machine.IF & 0b10, 'la coïncidence STAT a frappé à l\'offset 0').toBe(0b10);
      expect(ppu.screen[N * 160], 'la ligne 30 n\'est PAS encore dessinée').toBe(0);

      // le "gestionnaire STAT" change SCX — comme dmg-acid2 le fait
      ppu.write(0xff43, 8); // SCX = 8

      // on avance jusqu'au dessin (offset 20) : il doit lire le NOUVEAU SCX
      machine.totalCycles = 114 * N + 25;
      ppu.check();
      expect(
        ppu.screen[N * 160],
        'le dessin lit SCX=8 (teinte 2), PAS SCX=0 (teinte 1) : le fix de timing',
      ).toBe(2);
    });
  });

  describe('intégration : le cœur de l\'écran réveille un jeu endormi', () => {
    it('HALT en attendant le VBlank : réveillé et servi au vecteur 0x40', () => {
      const serial = { read() {}, write() {}, echo() {} };
      const timer = { read: () => 0, write() {} };
      const joypad = { read: () => 0xff, write() {} };
      const cbs = [];
      const clock = {
        onTick(cb) { cbs.push(cb); },
        start() {}, stop() {},
        tick() { cbs.forEach((cb) => cb({ detail: 'tick' })); },
      };
      const apu = { read: () => 0, write() {}, check() {} };
      const memory = buildMemory(undefined, serial, timer, undefined, joypad, apu);
      const cpu = new CPU(memory);
      const Decoder = buildDecoder(cpu, buildInstructions());
      const Machine = buildMachine(memory, cpu, new Decoder(), clock, serial);
      const machine = new Machine();

      // une cartouche factice : HALT à l'entrée, et au vecteur VBlank (0x40)
      // le gestionnaire écrit A=0x42 puis boucle sur place
      const rom = new Uint8Array(0x8000);
      rom[0x0100] = 0x76; // HALT
      rom[0x0040] = 0x3e; rom[0x0041] = 0x42; // LD A, 0x42
      rom[0x0042] = 0x18; rom[0x0043] = 0xfe; // JR -2
      machine.plugCartridge({ mbc: { read: (a) => rom[a], write() {} } });

      cpu.start(); // IME allumé
      cpu.memory.write(0xffff, 0b00001); // IE : VBlank autorisé
      clock.tick(); // une trame entière : le faisceau atteint la ligne 144 en chemin

      expect(
        hex(cpu.registers.A.getValue(), 2),
        'le gestionnaire VBlank a tourné : l\'écran a réveillé la console',
      ).toBe('0x42');
    });
  });
});

// OPTION A — le PPU « fonction pure de l'horloge ».
// Au lieu de lire un `this.mode` MUTÉ par check(), on CALCULE mode/LY depuis
// `totalCycles`, exactement comme le timer calcule TIMA depuis `innerCycles`.
// C'est la brique de base : purement additive (elle ne débranche rien encore),
// on la câblera aux lectures à l'étape suivante.
//
// Géométrie, en M-cycles (1 M-cycle = 4 dots) :
//   1 ligne = 114 M-cycles = 456 dots
//   mode 2 (scan OAM) : dots [0, 80)          = M-cycles [0, 20)
//   mode 3 (dessin)   : dots [80, 80 + len)   avec len = 172 + pénalité(ligne)
//   mode 0 (HBlank)   : jusqu'à 456
// Sans pénalité, len = 172 : le mode 3 finit au dot 252 = M-cycle 63.
describe('Option A : `computeState` — mode/LY calculés depuis l\'horloge (fonction pure)', () => {
  it('`wake()` fige l\'origine sur l\'horloge courante', () => {
    const { machine, ppu } = makePPU();
    machine.totalCycles = 500;
    ppu.wake();
    expect(ppu.origin, 'origine = totalCycles à l\'allumage').toBe(500);
  });

  // On teste les bandes NORMALES sur la ligne 1 : la ligne 0 porte le quirk
  // d'allumage (pas de scan OAM), traité par un test dédié juste après.
  const L1 = 114; // décalage d'une ligne, en M-cycles

  it('les bandes d\'une ligne visible normale (ligne 1, SCX=0) : 2 → 3 → 0', () => {
    const { machine, ppu } = makePPU();
    ppu.origin = 0;

    machine.totalCycles = L1 + 10; // dot 40 : plein scan OAM
    expect(ppu.computeState().mode, 'dot 40 : mode 2').toBe(2);

    machine.totalCycles = L1 + 20; // dot 80 : le dessin commence
    expect(ppu.computeState().mode, 'dot 80 : mode 3').toBe(3);

    machine.totalCycles = L1 + 62; // dot 248 : encore le dessin
    expect(ppu.computeState().mode, 'dot 248 : mode 3').toBe(3);

    machine.totalCycles = L1 + 63; // dot 252 = 80 + 172 : HBlank
    expect(ppu.computeState().mode, 'dot 252 : mode 0').toBe(0);
  });

  it('quirk d\'allumage : la ligne 0 n\'a pas de scan OAM — sa bande mode 2 se lit 0', () => {
    const { machine, ppu } = makePPU();
    ppu.origin = 0; // allumage à l'instant 0 : la toute première ligne est spéciale

    machine.totalCycles = 10; // dot 40 : là où une ligne normale scannerait l'OAM
    expect(ppu.computeState().mode, 'ligne 0 : mode 0 au lieu de mode 2').toBe(0);

    machine.totalCycles = 20; // dot 80 : le dessin démarre, comme d'habitude
    expect(ppu.computeState().mode, 'ligne 0 : mode 3 dès le dot 80').toBe(3);

    machine.totalCycles = 63; // dot 252 : HBlank en fin de ligne, comme d'habitude
    expect(ppu.computeState().mode, 'ligne 0 : mode 0 en fin de ligne').toBe(0);
  });

  it('LY = la ligne, avance tous les 114 M-cycles ; VBlank dès la ligne 144', () => {
    const { machine, ppu } = makePPU();
    ppu.origin = 0;

    machine.totalCycles = 114; // ligne 1, dot 0
    expect(ppu.computeState().line, 'début de la ligne 1').toBe(1);
    expect(ppu.computeState().mode, 'une ligne fraîche redémarre en scan OAM').toBe(2);

    machine.totalCycles = 114 * 144; // ligne 144
    expect(ppu.computeState().line, 'la ligne 144').toBe(144);
    expect(ppu.computeState().mode, 'lignes 144-153 : VBlank').toBe(1);

    machine.totalCycles = 114 * 154; // trame suivante : retour ligne 0
    expect(ppu.computeState().line, 'la trame boucle à 154').toBe(0);
  });

  it('SCX étend le mode 3 : au même instant, SCX=3 dessine encore là où SCX=0 est en HBlank', () => {
    const { machine, ppu } = makePPU();
    ppu.origin = 0;
    machine.totalCycles = L1 + 63; // dot 252 sur la ligne 1 (hors quirk)

    // SCX=0 : len = 172, le mode 3 finit PILE ici → HBlank
    ppu.write(0xff43, 0);
    expect(ppu.computeState().mode, 'SCX=0 : mode 0 au dot 252').toBe(0);

    // SCX=3 : len = 175, le mode 3 court jusqu'au dot 255 → encore le dessin
    ppu.write(0xff43, 3);
    expect(ppu.computeState().mode, 'SCX=3 : mode 3 au dot 252').toBe(3);
  });
});
