import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import buildCartridge from '../cartridge/Cartridge';

/**
 * L'ORACLE DE L'APU : blargg dmg_sound, 12 ROMs.
 *
 * Même protocole que cpu_instrs — la ROM s'auto-teste et écrit son verdict sur le port
 * série. Le dossier est balayé : déposer une ROM, c'est l'activer.
 *
 * Ce qu'elles arbitrent, et qu'aucun de nos tests unitaires ne peut trancher :
 *   02-len ctr        la phase exacte du frame sequencer, et l'extra length clocking
 *   03-trigger        la sémantique complète du trigger
 *   07-len sweep...   la synchronisation longueur/sweep sur le compteur de DIV
 *   08-len ctr...     la survie des compteurs de longueur à l'extinction (DMG)
 *   11-regs after...  l'état des registres après extinction
 *
 * Les ROMs qui portent sur des canaux non écrits (04, 05, 06 pour le sweep du canal 1 ;
 * 09, 10, 12 pour la wave du canal 3) échoueront tant que ces canaux n'existent pas.
 * C'est attendu : ce fichier est un tableau de bord, pas une exigence de tout-vert.
 */
const FIXTURES_DIR = resolve(process.cwd(), 'src/test/fixtures/dmg_sound');
const roms = existsSync(FIXTURES_DIR)
  ? readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.gb')).sort()
  : [];

const Cartridge = buildCartridge();
const instructions = buildInstructions();

const buildManivelle = () => {
  const cbs = [];
  return {
    onTick(cb) { cbs.push(cb); },
    start() {},
    stop() {},
    tick() { cbs.forEach((cb) => cb({ detail: 'tick' })); },
  };
};

const buildSerial = () => ({
  output: '',
  read() {},
  write() {},
  echo(buffer) { this.output = String.fromCharCode(...buffer); },
});

/**
 * `18 FE` = `JR -2`, un saut sur lui-même : la boucle d'abandon de blargg. Une ROM qui y
 * tombe n'écrira plus jamais rien, donc l'attendre 3000 trames ne fait que perdre du temps.
 * La reconnaître fait passer le fichier de quatre minutes à quelques secondes.
 */
const estBoucleDAbandon = (memory, pc) =>
  memory.read(pc) === 0x18 && memory.read(pc + 1) === 0xFE;

/**
 * Le seul diagnostic qu'on obtienne de ces ROMs.
 *
 * Blargg saute à cette boucle dès qu'une lecture de registre ne rend pas ce qu'il attend,
 * et cette routine — `LD A,0` / `LDH (FF26),A` / `JR -2` — coupe l'APU et se fige sans
 * rien imprimer. Le texte accumulé n'est jamais vidé sur le port série, donc pas de
 * « Failed #N ».
 *
 * En revanche le dernier échange avec l'APU avant le blocage désigne le registre fautif
 * et la valeur qui a déçu : c'est aussi précis qu'un numéro d'erreur.
 */
const brancherJournal = (apu, taille = 14) => {
  const journal = [];
  const hex = (n, largeur = 2) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(largeur, '0');
  const pousser = (entree) => {
    journal.push(entree);
    if (journal.length > taille) journal.shift();
  };

  const read = apu.read.bind(apu);
  const write = apu.write.bind(apu);
  apu.read = (addr) => {
    const value = read(addr);
    pousser(`R ${hex(addr, 4)}->${hex(value)}`);
    return value;
  };
  apu.write = (addr, value) => {
    pousser(`W ${hex(addr, 4)}=${hex(value)}`);
    return write(addr, value);
  };
  return journal;
};

const runRom = (fileName, maxFrames = 3000) => {
  const serial = buildSerial();
  const clock = buildManivelle();
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const decoder = new Decoder();
  const Machine = buildMachine(memory, cpu, decoder, clock, serial);
  const machine = new Machine();

  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, fileName)));
  machine.plugCartridge(new Cartridge(bytes));
  const journal = brancherJournal(machine.apu);

  let frames = 0;
  let abandon = false;
  while (frames < maxFrames && !/Passed|Failed/.test(serial.output)) {
    clock.tick();
    frames++;
    if (estBoucleDAbandon(machine.memory, cpu.registers.PC.getValue())) {
      abandon = true;
      break;
    }
  }
  return { output: serial.output, frames, abandon, journal };
};

describe('Blargg dmg_sound : l\'oracle de l\'APU, ROM par ROM', () => {
  it.skipIf(roms.length === 0).each(roms)(
    '%s écrit « Passed » sur le port série',
    (fileName) => {
      const { output, frames, abandon, journal } = runRom(fileName);
      const fin = abandon
        ? `blocage après ${frames} trames`
        : `plafond de ${frames} trames atteint`;
      expect(
        output,
        `${fin}\n  derniers échanges APU : ${journal.join('  ')}\n  bande série`,
      ).toContain('Passed');
    },
    60000,
  );
});
