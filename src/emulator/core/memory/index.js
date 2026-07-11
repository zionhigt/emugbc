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
            if (section.stop < addr) continue;
            if (section.start <= addr && section.stop >= addr) return section.instance;
            return null;
        }
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

export default function(cartridge) {
    const memory = new Memory();
    let overflowStart = 0;
    if (cartridge?.mbc) {
        overflowStart = 0x8000;
        const mbc = FactoryMBCSection(cartridge.mbc);
        memory.bindRange("MBC", 0, 0x7FFF, mbc);
    }
    // TODO: Explods for each sections
    memory.bindRange("overflow", overflowStart, 0xFFFF, Section);
    return memory;
}