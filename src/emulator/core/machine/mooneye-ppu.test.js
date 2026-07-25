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
 * MOONEYE — acceptance/ppu.
 *
 * L'oracle matériel du chapitre PPU (gekkio), au dot près : allumage de l'écran
 * (lcdon_timing), fenêtres d'écriture pendant l'allumage (lcdon_write_timing),
 * bornes des modes 0/2/3 (intr_2_*, hblank_ly_scx), blocage de la ligne STAT
 * (stat_irq_blocking), coïncidence LYC (stat_lyc_onoff), IRQ VBlank+STAT
 * (vblank_stat_intr). Ces ROMs mesurent le PPU au T-cycle et devraient rester
 * ROUGES tant que le modèle reste « scanline à bornes fixes » : elles balisent
 * le plan de corrections à venir.
 *
 * PROTOCOLE (identique au chapitre timer, cf. common/lib/quit.s) : le test
 * rend son verdict sur le port série.
 *   - réussite : les nombres de Fibonacci 3, 5, 8, 13, 21, 34
 *   - échec    : six fois l'octet 0x42
 * Puis il HALT. La bande série suffit ; ni la balise `ld b,b` ni les registres
 * ne sont nécessaires. La seule dépendance PPU du RAPPORT est LY (pour que
 * `wait_ly_with_timeout` et `is_ppu_broken` avancent) — LY fonctionne déjà.
 *
 * NB : la machine complète (PPU + timer + joypad) n'existe qu'après
 * plugCartridge, qui reconstruit la mémoire avec tous les périphériques câblés.
 */

const FIXTURES_DIR = resolve(
  process.cwd(),
  'src/test/fixtures/mooneye/build/acceptance/ppu',
);
const roms = existsSync(FIXTURES_DIR)
  ? readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.gb')).sort()
  : [];

// Le verdict, en octets.
const REUSSITE = [3, 5, 8, 13, 21, 34];
const VERDICT_LONGUEUR = REUSSITE.length;

// Ce qui a été REÇU, relu en ASCII pour l'affichage : 0x42 est le « B » majuscule,
// donc une bande ratée se lit « BBBBBB ».
const enTexte = (octets) => String.fromCharCode(...octets);

// Trois issues très différentes qu'il ne faut pas confondre : la ROM n'a pas parlé,
// la ROM a dit « raté », ou elle a dit autre chose.
const diagnostic = ({ verdict, brut, frames, estEchecMooneye }) => {
  if (verdict.length === 0) {
    return `RIEN reçu après ${frames} trames : la ROM n'a jamais rendu son verdict `
      + `(elle est bloquée, ou le PPU ne relaie pas LY au rapporteur)`;
  }
  if (estEchecMooneye) {
    return `la ROM a rendu son verdict après ${frames} trames et il est NÉGATIF `
      + `(six fois 0x42, le signal d'échec de mooneye). Le PPU diverge du matériel.`;
  }
  return `bande série inattendue après ${frames} trames : [${verdict}] («${brut}») `
    + `— ni Fibonacci, ni le motif d'échec de mooneye`;
};

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
  output: [],
  read() {},
  write() {},
  echo(buffer) { this.output = buffer; },
});

// Insère la ROM, tourne la manivelle jusqu'au verdict (6 octets) ou au plafond.
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

  let frames = 0;
  while (frames < maxFrames && serial.output.length < VERDICT_LONGUEUR) {
    clock.tick();
    frames++;
  }
  return { verdict: serial.output, brut: enTexte(serial.output), frames };
};

describe('Mooneye acceptance/ppu : l\'oracle matériel du chapitre PPU', () => {
  it.skipIf(roms.length === 0).each(roms)(
    '%s envoie Fibonacci sur le port série',
    (fileName) => {
      const { verdict, brut, frames } = runRom(fileName);
      const estEchecMooneye = verdict.length === 6 && verdict.every((o) => o === 0x42);
      expect(verdict, diagnostic({ verdict, brut, frames, estEchecMooneye })).toEqual(REUSSITE);
    },
    60000,
  );
});
