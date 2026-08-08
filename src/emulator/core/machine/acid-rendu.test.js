import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import buildCartridge from '../cartridge/Cartridge';
import { CGB } from '../models';

/**
 * LE HARNAIS DE RENDU — prérequis P1 du jalon CGB.
 *
 * `dmg-acid2.gb` dormait dans les fixtures sans que rien ne l'exécute : tout le
 * chemin de rendu du PPU n'avait aucun filet d'image, seulement des TU unitaires.
 * Le refactor du lot 0 est passé dessus à découvert.
 *
 * CE QUE CE HARNAIS PROUVE, ET CE QU'IL NE PROUVE PAS. L'instantané ci-dessous
 * est produit par NOTRE code : il attrape les RÉGRESSIONS — un pixel qui bouge
 * se voit — mais il ne prouve RIEN sur la justesse, puisqu'il fige nos bugs
 * actuels avec la même autorité que nos succès. Il ne remplace pas la
 * comparaison avec l'image de référence du dépôt de la ROM, qui reste à faire.
 * Ne pas le lire comme « dmg-acid2 passe ».
 *
 * L'instantané est en ASCII, pas en empreinte : une empreinte dirait seulement
 * « ça a changé », l'ASCII montre OÙ. On lit le visage dans le fichier .snap, et
 * un diff de régression se lit à l'œil.
 */

const ROM = resolve(process.cwd(), 'src/test/fixtures/dmg-acid2.gb');
const ROM_CGB = resolve(process.cwd(), 'src/test/fixtures/cgb-acid2.gbc');

// De quoi laisser la ROM s'installer et peindre : elle dessine dès les premières
// trames, la marge est là pour ne pas dépendre d'un compte exact.
const FRAMES = 120;

const Cartridge = buildCartridge();
const instructions = buildInstructions();

const buildManivelle = () => {
  const cbs = [];
  return {
    onTick(cb) { cbs.push(cb); },
    start() {}, stop() {},
    tick() { cbs.forEach((cb) => cb({ detail: 'tick' })); },
  };
};

const runRom = (path, frames, model) => {
  const serial = { output: [], read() {}, write() {}, echo() {} };
  const clock = buildManivelle();
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const Machine = buildMachine(memory, cpu, new Decoder(), clock, serial);
  const machine = model === undefined ? new Machine() : new Machine(model);
  machine.plugCartridge(new Cartridge(new Uint8Array(readFileSync(path))));
  for (let i = 0; i < frames; i++) clock.tick();
  return machine;
};

// Les quatre teintes DMG, de la plus claire à la plus sombre.
const SHADES = [' ', '.', '+', '#'];

const toAscii = (screen) => {
  const lines = [];
  for (let y = 0; y < 144; y++) {
    let line = '';
    for (let x = 0; x < 160; x++) line += SHADES[screen[y * 160 + x] & 3];
    lines.push(line);
  }
  return lines.join('\n');
};

describe.skipIf(!existsSync(ROM))('dmg-acid2 : le filet du chemin de rendu', () => {
  it('peint quelque chose — ni écran vide, ni écran uni', () => {
    // Le garde-fou le plus bête et le plus utile : un tampon resté à zéro, ou
    // rempli d'une seule teinte, passerait n'importe quel instantané qu'on
    // régénérerait ensuite sans regarder.
    const { ppu } = runRom(ROM, FRAMES);
    const shades = new Set(ppu.screen);

    expect(shades.size, `l'écran n'a qu'une teinte (${[...shades]})`).toBeGreaterThan(1);
    expect(ppu.screen.length).toBe(160 * 144);
  });

  it('rend la même image qu\'au dernier instantané', () => {
    const { ppu } = runRom(ROM, FRAMES);
    expect(toAscii(ppu.screen)).toMatchSnapshot();
  });

  it('est déterministe : deux exécutions donnent le même écran', () => {
    // Sans ça, l'instantané serait un piège à faux positifs.
    const a = runRom(ROM, FRAMES).ppu.screen;
    const b = runRom(ROM, FRAMES).ppu.screen;
    expect([...a]).toEqual([...b]);
  });
});

/**
 * cgb-acid2 — LA LIGNE DE BASE, PAS UN VERDICT.
 *
 * Cette ROM n'a aucune chance de rendre juste aujourd'hui : il n'existe ni
 * banque de VRAM, ni palettes, ni étiquettes de tuile. Elle est branchée
 * MAINTENANT quand même, et c'est délibéré — c'est la conséquence de la règle
 * d'oracle du cahier. Un oracle gardé pour la fin ne peut plus localiser la
 * faute ; celui-ci va au contraire enregistrer un état à chaque lot, et l'écart
 * entre deux instantanés dira ce que le lot a réellement changé à l'image.
 *
 * Ne pas lire un instantané vert comme « cgb-acid2 passe ». Il ne passera que
 * quand il sera comparé à l'IMAGE DE RÉFÉRENCE de son dépôt, qui reste à
 * récupérer — voir le prérequis P1 du cahier.
 */
describe.skipIf(!existsSync(ROM_CGB))('cgb-acid2 : la ligne de base du jalon CGB', () => {
  it('démarre et peint quelque chose en modèle CGB', () => {
    const { ppu, model } = runRom(ROM_CGB, FRAMES, CGB);

    expect(model, 'forcé en CGB : la ROM est marquée 0xC0, CGB seulement').toBe(CGB);
    expect(new Set(ppu.screen).size, 'un écran uni voudrait dire qu\'elle n\'a rien dessiné')
      .toBeGreaterThan(1);
  });

  it('instantané de l\'état AVANT tout support CGB', () => {
    expect(toAscii(runRom(ROM_CGB, FRAMES, CGB).ppu.screen)).toMatchSnapshot();
  });
});
