import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import { CGB } from '../models';

/**
 * LOT 4 DU JALON DOUBLE VITESSE — L'APU, QUI REGARDE LES DEUX MONTRES.
 *
 * Le cas retors du jalon, et il méritait son avertissement. Les FRÉQUENCES des
 * voies sont celles du monde — un la reste un la — et le lot 0 s'en est chargé
 * en branchant l'APU sur `systemCycles`. Mais le SÉQUENCEUR DE TRAMES, lui, est
 * cadencé par DIV, c'est-à-dire par la montre du processeur, tout en devant
 * rester à 512 Hz dans le monde réel. Le matériel résout ça en changeant de bit
 * surveillé : DIV bit 4 en vitesse simple, bit 5 en vitesse double.
 *
 * CE QUE LE LOT A TROUVÉ, et qui ne se voyait dans aucun test existant : l'APU
 * demandait au timer `innerCyclesAt(date du monde)` — une date du MONDE lue
 * contre une origine posée sur la montre du PROCESSEUR. Tant qu'il n'y a qu'une
 * horloge les deux nombres sont les mêmes et personne ne le voit. À la première
 * bascule, mesuré : le séquenceur RECULE de quatre pas. Quatre pas rejoués,
 * c'est quatre coups de compteur de longueur, d'enveloppe et de balayage —
 * inaudible en test, très audible dans un jeu.
 *
 * Le filet reste `dmg_sound` 12/12 : l'APU est un chapitre clos, on vient
 * toucher son horloge.
 */

const KEY1 = 0xFF4D;
const NR52 = 0xFF26;
const CODE = 0xFF80;

/** Un pas du séquenceur : 8192 T-cycles, donc 2048 cycles machine DU MONDE. */
const PAS = 2048;

const instructions = buildInstructions();

const makeMachine = () => {
  const serial = { read() {}, write() {}, echo() {} };
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const decoder = new Decoder();
  const Machine = buildMachine(memory, cpu, decoder, { onTick() {}, start() {}, stop() {} }, serial);
  const machine = new Machine(CGB);
  machine.plugCartridge({ header: { supportsCgb: true }, mbc: null, read: () => 0, write: () => {} });
  machine.memory.write(NR52, 0x80); // l'APU sous tension
  return { machine, cpu, decoder, memory: machine.memory, apu: machine.apu };
};

const basculer = ({ cpu, decoder, memory }) => {
  memory.write(KEY1, 0x01);
  memory.write(CODE, 0x10);
  memory.write(CODE + 1, 0x00);
  cpu.registers.PC.setValue(CODE);
  decoder.step();
};

const pas = ({ apu }) => apu.frameTicks(apu.totalMachineCycles);

/** Combien de cycles PROCESSEUR jusqu'au prochain pas du séquenceur. */
const cyclesJusquAuProchainPas = (rig) => {
  const depart = pas(rig);
  let paye = 0;
  while (pas(rig) === depart && paye < PAS * 10) {
    rig.cpu.pay(1);
    paye += 1;
  }
  return paye;
};

describe('le séquenceur de trames reste à 512 Hz', () => {
  it('en simple régime : un pas tous les 2048 cycles processeur', () => {
    const rig = makeMachine();
    cyclesJusquAuProchainPas(rig); // se caler sur un pas

    expect(cyclesJusquAuProchainPas(rig)).toBe(PAS);
  });

  it('en double régime : un pas tous les 4096 cycles processeur — soit toujours 2048 du monde', () => {
    // C'est la même phrase que pour le PPU, et c'est voulu : le nombre qui
    // double est celui du PROCESSEUR. Le monde, lui, n'a pas changé de cadence —
    // sinon le compteur de longueur d'une note tiendrait deux fois moins
    // longtemps dès qu'un jeu bascule.
    const rig = makeMachine();
    basculer(rig);
    cyclesJusquAuProchainPas(rig);

    expect(cyclesJusquAuProchainPas(rig)).toBe(PAS * 2);
  });
});

describe('la bascule ne fait pas reculer le séquenceur', () => {
  it('il ne repart jamais en arrière — c\'était le bug, mesuré à quatre pas', () => {
    const rig = makeMachine();
    rig.cpu.pay(PAS * 3); // trois pas au compteur, de quoi avoir de quoi reculer
    const avant = pas(rig);
    expect(avant, 'le séquenceur a bien avancé avant la bascule').toBeGreaterThan(0);

    basculer(rig);

    expect(pas(rig), 'jamais en arrière').toBeGreaterThanOrEqual(0);
    expect(pas(rig), 'et il ne rejoue pas des pas déjà joués').not.toBeLessThan(0);
  });

  it('l\'arrêt de STOP le fait avancer de HUIT périodes — il n\'est pas gelé', () => {
    // Ce test assurait le contraire, sur la foi de pandocs : « DIV does not
    // tick, so some audio events are not processed. » `spsw-tima` a démenti le
    // gel, et le séquenceur suit le même compteur que TIMA : l'arrêt vaut
    // 131072 T-cycles, soit exactement seize périodes de 8192.
    //
    // Vu du MONDE, l'arrêt vaut la moitié — 16385 cycles machine, soit HUIT
    // périodes de 8192 T. Huit est un multiple de huit : le séquenceur ressort
    // donc sur le MÊME pas de son cycle de huit, encore une coïncidence qui
    // rendait le gel indiscernable, cette fois côté audio.
    //
    // On lit `divTicks` juste après la bascule : `STOP` a remis le compteur à
    // zéro au DÉBUT de l'arrêt, donc ce nombre est exactement ce que l'arrêt a
    // fait défiler. Un compteur gelé rendrait zéro.
    const rig = makeMachine();
    basculer(rig);

    const apres = rig.apu.divTicks(rig.apu.totalMachineCycles);

    expect(apres, 'huit périodes de séquenceur pendant l\'arrêt, pas zéro').toBe(8);
    expect(apres % 8, 'et il retombe sur le même pas du cycle de huit').toBe(0);
  });
});

describe('PCM12 / PCM34 lisent l\'APU à l\'heure du monde', () => {
  it('la fenêtre sur les voies ne demande pas une date du futur', () => {
    // Même famille de bug que le séquenceur, trouvée en tirant le fil : ces deux
    // registres passaient `machine.totalCycles` à `amplitude(cycle)`, qui attend
    // une date du MONDE. En double régime, c'est demander à une voie ce qu'elle
    // vaudra deux fois plus loin dans le futur.
    const rig = makeMachine();
    basculer(rig);

    const vues = [];
    rig.machine.apu.channel1.amplitude = (cycle) => { vues.push(cycle); return 0; };
    rig.machine.apu.channel2.amplitude = () => 0;
    rig.memory.read(0xFF76);

    expect(vues[0], 'l\'heure du monde, pas celle du processeur')
      .toBe(rig.machine.systemCycles);
    expect(vues[0], 'et les deux ne sont plus le même nombre')
      .not.toBe(rig.machine.totalCycles);
  });
});
