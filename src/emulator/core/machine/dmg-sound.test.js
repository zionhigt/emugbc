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
 * Contrairement à cpu_instrs, ces ROMs n'écrivent RIEN sur le port série. Elles déposent
 * leur verdict en RAM cartouche, à partir de $A000 :
 *
 *   $A000        code : 0x80 tant que le test tourne, 0x00 s'il réussit, sinon le
 *                numéro du sous-test qui a échoué
 *   $A001-$A003  signature 0xDE 0xB0 0x61 — tant qu'elle n'est pas là, le reste est du bruit
 *   $A004...     le texte, terminé par un zéro : le nom de la ROM, puis la phrase du
 *                sous-test fautif, puis « Failed #N » ou « Passed »
 *
 * C'est cette phrase qui a de la valeur : elle nomme la règle matérielle qu'on n'a pas
 * encore. Le numéro seul ne dit rien.
 *
 * Le dossier est balayé : déposer une ROM, c'est l'activer.
 */
const FIXTURES_DIR = resolve(process.cwd(), 'src/test/fixtures/dmg_sound');
const roms = existsSync(FIXTURES_DIR)
  ? readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.gb')).sort()
  : [];

const Cartridge = buildCartridge();
const instructions = buildInstructions();

const SIGNATURE = [0xDE, 0xB0, 0x61];
const EN_COURS = 0x80;
const REUSSI = 0x00;

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

/** La signature n'apparaît qu'une fois le protocole armé : avant, $A000 est du hasard. */
const verdictArme = (memory) =>
  SIGNATURE.every((octet, i) => memory.read(0xA001 + i) === octet);

const lireVerdict = (memory) => {
  if (!verdictArme(memory)) return { code: EN_COURS, texte: '' };
  let texte = '';
  for (let addr = 0xA004; addr < 0xA004 + 1024; addr++) {
    const octet = memory.read(addr);
    if (octet === 0x00) break;
    texte += String.fromCharCode(octet);
  }
  return { code: memory.read(0xA000), texte: texte.trim() };
};

/**
 * `18 FE` = `JR -2`, un saut sur lui-même. Blargg y atterrit après avoir écrit son
 * verdict : c'est le signal que la ROM n'a plus rien à dire. La reconnaître fait passer
 * ce fichier de quatre minutes à quelques secondes.
 */
const estBoucleDAbandon = (memory, pc) =>
  memory.read(pc) === 0x18 && memory.read(pc + 1) === 0xFE;

/**
 * Le verdict nomme la règle fautive, mais pas la séquence qui l'a mise en défaut. Ce
 * journal la donne : chaque accès APU avec sa date en tics de carillon, ce qui est la
 * seule façon de savoir sur quelle étape du séquenceur blargg écrit.
 *
 * Coûteux et bruyant, donc éteint par défaut :
 *   APU_JOURNAL=44 npx vitest run src/emulator/core/machine/dmg-sound.test.js -t "03-trigger"
 */
const brancherJournal = (apu, taille) => {
  const journal = [];
  const hex = (n, largeur = 2) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(largeur, '0');
  const pousser = (entree) => {
    journal.push(entree);
    if (journal.length > taille) journal.shift();
  };
  const etape = () => `@tic ${apu.frameTicks(apu.totalMachineCycles)} etape ${apu.frameStep(apu.totalMachineCycles)}`;
  const read = apu.read.bind(apu);
  const write = apu.write.bind(apu);
  apu.read = (addr) => {
    const value = read(addr);
    pousser(`R ${hex(addr, 4)} -> ${hex(value)}  ${etape()}`);
    return value;
  };
  apu.write = (addr, value) => {
    pousser(`W ${hex(addr, 4)} = ${hex(value)}  ${etape()}`);
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
  // plugCartridge remonte la mémoire autour de la cartouche : c'est CETTE instance qui
  // porte la RAM cartouche, pas celle passée au constructeur.
  const bus = machine.memory;
  const taille = Number(process.env.APU_JOURNAL || 0);
  const journal = taille > 0 ? brancherJournal(machine.apu, taille) : null;

  // On ne lit le verdict qu'à l'arrêt : blargg pose son code AVANT d'avoir fini d'écrire
  // le texte, et c'est le texte qui a de la valeur. Réussite comme échec, il termine
  // toujours dans la boucle d'abandon — c'est son « j'ai fini ».
  let frames = 0;
  while (frames < maxFrames) {
    clock.tick();
    frames++;
    if (estBoucleDAbandon(bus, cpu.registers.PC.getValue())) break;
  }
  return { ...lireVerdict(bus), frames, journal };
};

describe('Blargg dmg_sound : l\'oracle de l\'APU, ROM par ROM', () => {
  it.skipIf(roms.length === 0).each(roms)(
    '%s réussit',
    (fileName) => {
      const { code, texte, frames, journal } = runRom(fileName);
      const entete = code === EN_COURS
        ? `aucun verdict après ${frames} trames — la ROM s'est figée sans conclure`
        : `Failed #${code} après ${frames} trames\n${texte}`;
      const diagnostic = journal
        ? `${entete}\n\nderniers échanges APU :\n${journal.join('\n')}`
        : entete;
      expect(code, diagnostic).toBe(REUSSI);
    },
    60000,
  );
});
