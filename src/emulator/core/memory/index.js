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

        read(addr) {
            this.serial.read(addr);
            return super.read(addr);
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

        read(addr) {
            if (this.mode === 3 || this.mode === 2 && this.nextMode === 3) return 0xFF;
            return this.memory._read(addr);
        }
        write(addr, value) {
            if (this.getMode(0) === 3) return;
            return this.memory._write(addr, value);
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

export default function(cartridge, serialbus, timer, ppu, joypad, apu) {
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
    memory.bindRange("overflow1", 0xFF03, 0xFF03, Section);
    timer = FactoryTimerSection(timer);
    memory.bindRange("timer", 0xFF04, 0xFF07, timer);
    // 0xFF0F (IF) vit dans cette plage : la laisser orpheline en découpant
    // pour l'APU coupe toutes les interruptions qui transitent par le bus.
    memory.bindRange("overflow2", 0xFF08, 0xFF0F, Section);
    apu = FactoryAPUSection(apu);
    memory.bindRange("apu", 0xFF10, 0xFF26, apu);
    memory.bindRange("overflow2_1", 0xFF27, 0xFF3F, Section);
    ppu = FactoryPPUSection(ppu);
    memory.bindRange("ppu", 0xFF40, 0xFF4B, ppu);
    memory.bindRange("overflow3", 0xFF4C, 0xFFFF, Section);
    return memory;
}