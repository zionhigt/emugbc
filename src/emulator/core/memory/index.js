import byte from "../../lib/byte";

/**
 * 
 * @returns Default raw memory
 */
class Memory {
    constructor() {
        this.ram = new Uint8Array(0x10000);
        this._sections = {};
        this._ram = {};
    }

    _section(addr) {
        return this._ram[addr] || null;
    }

    getSectionByTag(tag) {
        return this._sections[tag];
    }

    _write(address, value) {
        this.ram[address] = value;
    }

    _read(address) {
        return this.ram[address];
    }
    
    write(address, value) {
        const section = this._section(address);
        if (section) return section.write(address, value);
        return null;
    }

    read(address) {
        const section = this._section(address);
        if (section) return section.read(address);
        return null;
    }

    bindRange(tag, start, stop, cls) {
        const instance = new cls(this);
        this._sections[tag] = {
            start: start,
            stop: stop,
            instance,
        }

        for (let s = start; s <= stop; s++) {
            this._ram[s] = instance;
        }
    }

    /**
     * Router des adresses ÉPARSES vers une même section. Le CGB pose ses
     * registres au milieu de trous (VBK en 0xFF4F, les palettes en 0xFF68-6B) :
     * ce ne sont pas des plages, et les énumérer ici évite d'inventer une carte
     * mémoire par modèle. Le PPU déclare ce qu'il possède, on le lui route.
     */
    bindAddresses(tag, addresses, cls) {
        if (!addresses.length) return;
        const instance = new cls(this);
        this._sections[tag] = { addresses, instance };
        for (const addr of addresses) {
            this._ram[addr] = instance;
        }
    }
}

class Section {
    constructor(memory) {
        this.memory = memory;
    }

    write() {
        return this.memory._write.apply(this.memory, arguments);
    }

    read() {
        return this.memory._read.apply(this.memory, arguments);
    }
}

/**
 * LES TROUS DU PLAN $FFxx.
 *
 * Toute adresse d'IO qui ne mène à aucun registre se lit 0xFF, et l'écriture s'y
 * perd. Ce n'est pas « de la mémoire qu'on n'utilise pas » : il n'y a rien
 * derrière, et le bus laisse ses lignes en l'air, donc à 1. `unused_hwio`
 * arbitre chacune de ces adresses une par une.
 *
 * C'est aussi le tiroir dans lequel le CGB viendra poser ses propres registres
 * (VBK, BCPS/BCPD, HDMA, SVBK...) : aujourd'hui trous, demain occupés.
 */
class UnmappedSection extends Section {
    read() {
        return 0xFF;
    }
    write() {
        return null;
    }
}

/**
 * Un registre bien réel, mais dont certains bits n'existent pas et se lisent à 1.
 * Même geste que `maskRegistersMapping` côté APU, pour les registres qui vivent
 * en RAM plate faute de propriétaire — SC et IF.
 */
function FactoryMaskedSection(mask) {
    class MaskedSection extends Section {
        read(addr) {
            return this.memory._read(addr) | mask;
        }
    }
    return MaskedSection;
}

function FactoryMBCSection(mbc) {
    class MBCSection extends Section {
        constructor(memory) {
            super(memory);
            this.mbc = mbc;
        }
    
        write(addr, value) {
            // super.write(addr, value);
            return this.mbc.write(addr, value);
        }

        read(addr) {
            return this.mbc.read(addr);
        }
    }
    return MBCSection;
}

function FactoryTimerSection(timer) {
    class TimerSection extends Section {
        constructor(memory) {
            super(memory);
            this.timer = timer;
        }
    
        write(addr, value) {
            if (addr !== 0xFF04) {
                super.write(addr, value);
            } else {
                value = 0;
            }
            return this.timer.write(addr, value);
        }

        read(addr) {
            return this.timer.read(addr);
        }
    }
    return TimerSection;
}

function FactoryAPUSection(apu) {
    class APUSection extends Section {
        constructor(memory) {
            super(memory);
            this.apu = apu;
        }
    
        write(addr, value) {
            if (addr !== 0xFF04) {
                super.write(addr, value);
            } else {
                value = 0;
            }
            return this.apu.write(addr, value);
        }

        read(addr) {
            return this.apu.read(addr);
        }
    }
    return APUSection;
}

function FactoryPPUSection(ppu) {
    class PPUSection extends Section {
        constructor(memory) {
            super(memory);
            this.ppu = ppu;
        }
    
        write(addr, value) {
            super.write(addr, value);
            return this.ppu.write(addr, value);
        }

        read(addr) {
            return this.ppu.read(addr);
        }
    }
    return PPUSection;
}

function FactorySerialSection(serial) {
    class SerialSection extends Section {
        constructor(memory) {
            super(memory);
            this.serial = serial;
            this._buffer = [];
        }
    
        write(addr, value) {
            super.write(addr, value);
            if (addr === 0xFF02 && byte.getFlag(value, 7)) {
                this._buffer.push(this.memory.read(0xFF01));
                this.echo();
            } 
            return this.serial.write(addr, value);
        }

        /**
         * SC (0xFF02) n'a que deux bits sur DMG : le 7 (départ du transfert) et
         * le 0 (horloge interne ou externe). Les cinq du milieu se lisent à 1 —
         * `unused_hwio` : `test SC %01111110`.
         *
         * Le masque vit ICI et non dans une section à part : 0xFF01 et 0xFF02
         * doivent rester sous la MÊME section, c'est elle qui guette le bit 7 de
         * SC pour déclencher l'écho. Les séparer coupe la sonnette, et avec elle
         * le verdict de toutes les ROMs blargg et mooneye.
         */
        read(addr) {
            this.serial.read(addr);
            const value = super.read(addr);
            return addr === 0xFF02 ? value | 0x7E : value;
        }

        echo() {
            this.serial.echo([...this._buffer]);
        }
    }
    return SerialSection;
}

function FactoryJoypadSection(joypad) {
    class JoypadStubSection extends Section {
        constructor(memory) {
            super(memory);
            this.joypad = joypad;
        }
        read(addr) {
            return this.joypad.read(addr);
        }
        write(addr, value) {
            return this.joypad.write(addr, value);
        }
    }

    return JoypadStubSection;
}

class PPURamSection extends Section {
    constructor(memory, ppu) {
        super(memory);
        this.ppu = ppu;
    }

    get mode() {
        return this.getMode(3);
    }
    get nextMode() {
        return this.getMode(7);
    }

    getMode(offset) {
        if (!this.ppu || !this.ppu.LCDC.isOn) return null;
        const { mode } = this.ppu.computeState(this.ppu.totalMachineCycles, offset);
        return mode;
    }

}

function FactoryVRAMSection(ppu) {
    class VRAMSection extends PPURamSection {
        constructor(memory) {
            super(memory, ppu);
        }

        // Le verrou du mode 3 d'abord, l'aiguillage de banque ensuite : c'est le
        // PPU qui sait laquelle des deux banques le CPU regarde (VBK en CGB, une
        // seule en DMG), donc on passe par lui plutôt que par la mémoire plate.
        read(addr) {
            if (this.mode === 3 || this.mode === 2 && this.nextMode === 3) return 0xFF;
            if (!this.ppu) return this.memory._read(addr);
            return this.ppu.vramRead(addr);
        }
        write(addr, value) {
            if (this.getMode(0) === 3) return;
            if (!this.ppu) return this.memory._write(addr, value);
            return this.ppu.vramWrite(addr, value);
        }
    }

    return VRAMSection;
}
function FactoryOAMSection(ppu) {
    class OAMSection extends PPURamSection {
        constructor(memory) {
            super(memory, ppu);
        }
        
        read(addr) {
            if ([2, 3].includes(this.mode) || this.mode === 0 && this.nextMode === 2) return 0xFF;
            return this.memory._read(addr);
        }
        write(addr, value) {
            if (this.mode === 3 || (this.mode === 2 && this.nextMode !== 3)) return;
            return this.memory._write(addr, value);
        }
    }

    return OAMSection;
}

/**
 * Le propriétaire des registres CGB qui ne sont pas du dessin ($FF70, $FF72-77),
 * et de la moitié haute de la WRAM, qu'il commute. Absent en DMG : la carte
 * mémoire ne teste pas le modèle, elle route ce qu'un propriétaire déclare.
 */
function FactoryCgbSection(cgb) {
    class CgbSection extends Section {
        read(addr) {
            return cgb.read(addr);
        }
        write(addr, value) {
            return cgb.write(addr, value);
        }
    }
    return CgbSection;
}

function FactoryWramBankSection(cgb) {
    class WramBankSection extends Section {
        read(addr) {
            return cgb.wramRead(addr);
        }
        write(addr, value) {
            return cgb.wramWrite(addr, value);
        }
    }
    return WramBankSection;
}

export default function(cartridge, serialbus, timer, ppu, joypad, apu, cgb) {
    const memory = new Memory();
    if (arguments.length === 0) {
        memory.bindRange("flat", 0x000, 0xFFFF, Section);
        return memory;
    }
    let mbc = Section;
    if (cartridge?.mbc) {
        mbc = FactoryMBCSection(cartridge.mbc);
    }
    memory.bindRange("MBC", 0, 0x7FFF, mbc);
    // TODO: Explods for each sections
    const vram = FactoryVRAMSection(ppu);
    memory.bindRange("vram", 0x8000, 0x9FFF, vram);
    memory.bindRange("overflow0", 0xA000, 0xFDFF, Section);
    const oam = FactoryOAMSection(ppu);
    memory.bindRange("oam", 0xFE00, 0xFE9F, oam);
    memory.bindRange("overflow0_1", 0xFEA0, 0xFEFF, Section);
    joypad = FactoryJoypadSection(joypad);
    memory.bindRange("joypad", 0xFF00, 0xFF00, joypad);
    serialbus = FactorySerialSection(serialbus);
    memory.bindRange("serial", 0xFF01, 0xFF02, serialbus);
    memory.bindRange("unmapped_ff03", 0xFF03, 0xFF03, UnmappedSection);
    timer = FactoryTimerSection(timer);
    memory.bindRange("timer", 0xFF04, 0xFF07, timer);
    memory.bindRange("unmapped_ff08", 0xFF08, 0xFF0E, UnmappedSection);
    // IF : cinq sources d'interruption, donc trois bits hauts en l'air. Attention,
    // la machine lit et écrit IF par `_read`/`_write`, sans passer par ce masque —
    // c'est voulu : le masque est ce que voit le CPU, pas ce que vaut le registre.
    memory.bindRange("interrupt_flag", 0xFF0F, 0xFF0F, FactoryMaskedSection(0xE0));
    apu = FactoryAPUSection(apu);
    memory.bindRange("apu", 0xFF10, 0xFF3F, apu);
    // Tout ce bloc est vide sur DMG. C'est là que le CGB pose ses registres —
    // d'où l'ordre : les trous d'abord, le PPU par-dessus (voir juste en dessous).
    memory.bindRange("unmapped_ff4c", 0xFF4C, 0xFF7F, UnmappedSection);
    const PPUSection = FactoryPPUSection(ppu);
    memory.bindRange("ppu", 0xFF40, 0xFF4B, PPUSection);
    // Les registres que le PPU réclame HORS de sa plage historique : VBK, et
    // demain les palettes. Il les DÉCLARE dans sa table, on les lui route — plutôt
    // qu'une carte mémoire par modèle, qui divergerait au premier ajout.
    const claimed = Object.keys(ppu?.registersMapping || {})
        .map(Number)
        .filter((addr) => addr < 0xFF40 || addr > 0xFF4B);
    memory.bindAddresses("ppu_extra", claimed, PPUSection);
    // Le système CGB, quand il y en a un : ses registres à lui, et la moitié
    // haute de la WRAM qui devient commutable (SVBK).
    if (cgb) {
        memory.bindAddresses(
            "cgb",
            Object.keys(cgb.registersMapping).map(Number),
            FactoryCgbSection(cgb),
        );
        memory.bindRange("wram_bank", 0xD000, 0xDFFF, FactoryWramBankSection(cgb));
    }
    // HRAM (0xFF80-0xFFFE) et IE (0xFFFF) : de la vraie mémoire, elle.
    memory.bindRange("hram", 0xFF80, 0xFFFF, Section);
    return memory;
}