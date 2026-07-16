/**
 * 
 * @returns Default raw memory
 */
class Memory {
    constructor() {
        this.ram = new Uint8Array(0x10000);
        this._sections = {}; 
    }

    _section(addr) {
        for (let tag in this._sections) {
            const section = this.getSectionByTag(tag);
            if (section.start <= addr && section.stop >= addr) return section.instance;
        }
        return null;
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
        this._sections[tag] = {
            start: start,
            stop: stop,
            instance: new cls(this),
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
            this._buffer = "";
        }
    
        write(addr, value) {
            super.write(addr, value);
            if (addr === 0xFF02 && value === 0x81) {
                this._buffer += String.fromCharCode(
                    this.memory.read(0xFF01)
                );
                this.echo();
            } 
            return this.serial.write(addr, value);
        }

        read(addr) {
            this.serial.read(addr);
            return super.read(addr);
        }

        echo() {
            this.serial.echo(this._buffer);
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

export default function(cartridge, serialbus, timer, ppu, joypad) {
    const memory = new Memory();
    if (arguments.length === 0) {
        memory.bindRange("flat", 0x000, 0xFFFF, Section);
        return memory;
    }
    let overflowStart = 0;
    if (cartridge?.mbc) {
        overflowStart = 0x8000;
        const mbc = FactoryMBCSection(cartridge.mbc);
        memory.bindRange("MBC", 0, 0x7FFF, mbc);
    }
    // TODO: Explods for each sections
    memory.bindRange("overflow0", overflowStart, 0xFEFF, Section);
    joypad = FactoryJoypadSection(joypad);
    memory.bindRange("joypad", 0xFF00, 0xFF00, joypad);
    serialbus = FactorySerialSection(serialbus);
    timer = FactoryTimerSection(timer);
    ppu = FactoryPPUSection(ppu);
    memory.bindRange("serial", 0xFF01, 0xFF02, serialbus);
    memory.bindRange("overflow1", 0xFF03, 0xFF03, Section);
    memory.bindRange("timer", 0xFF04, 0xFF07, timer);
    memory.bindRange("overflow2", 0xFF08, 0xFF3F, Section);
    memory.bindRange("ppu", 0xFF40, 0xFF4B, ppu);
    memory.bindRange("overflow3", 0xFF4C, 0xFFFF, Section);
    return memory;
}