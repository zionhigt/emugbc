import { describe, it, expect } from 'vitest';

import buildMemory from './CPUMemory';

const CPUMemory = buildMemory();

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

describe('CPUMemory (RAM plate 64 Ko)', () => {
  it('lit 0x00 sur une adresse jamais écrite', () => {
    const memory = new CPUMemory();
    expect(hex(memory.read(0xc000), 2), 'read(0xC000) sans écriture préalable').toBe('0x00');
  });

  it("relit ce qu'elle a écrit", () => {
    const memory = new CPUMemory();
    memory.write(0xc123, 0x2a);
    expect(hex(memory.read(0xc123), 2), 'write(0xC123, 0x2A) puis read(0xC123)').toBe('0x2A');
  });

  it('stocke des octets : les valeurs wrappent sur 8 bits', () => {
    const memory = new CPUMemory();
    memory.write(0xc000, 0x1ff);
    expect(hex(memory.read(0xc000), 2), 'write(0x1FF) doit wrapper comme un registre 8 bits').toBe('0xFF');
  });

  it("couvre tout l'espace d'adressage 16 bits (0x0000 à 0xFFFF)", () => {
    const memory = new CPUMemory();
    memory.write(0x0000, 0x11);
    memory.write(0xffff, 0x22);
    expect(hex(memory.read(0x0000), 2), 'première adresse').toBe('0x11');
    expect(hex(memory.read(0xffff), 2), 'dernière adresse').toBe('0x22');
  });

  it('deux adresses voisines sont indépendantes', () => {
    const memory = new CPUMemory();
    memory.write(0xc000, 0xaa);
    memory.write(0xc001, 0xbb);
    expect(hex(memory.read(0xc000), 2)).toBe('0xAA');
    expect(hex(memory.read(0xc001), 2)).toBe('0xBB');
  });
});
