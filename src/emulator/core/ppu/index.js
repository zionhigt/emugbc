import { Register } from "../../lib/register";
import byte from "../../lib/byte";

class LYregister extends Register(8) {
    
    constructor(parent) {
        super();
        this.parent = parent;
    }

    getValue() {
        if (!this.parent.LCDC.isOn) return 0;
        return this.parent.line;
    }
}
class LYCregister extends Register(8) {
    
    constructor(parent) {
        super();
        this.parent = parent;
    }

    setValue(value) {
        super.setValue(value);
        this.parent.updateStat();
    }
}

class LCDCregister extends Register(8) {
    constructor(parent) {
        super();
        super.setValue(0x91);
        this.parent = parent;
    }

    get isOn() {
        return byte.getFlag(this.getValue(), 7);
    }

    setValue(value) {
        const a = this.isOn;
        const b = byte.getFlag(value, 7);
        super.setValue(value);
        if (a !== b) {
            if (b) return this.parent.wake();
            return this.parent.sleep();
        }
    }
}
class STATregister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }

    get bus() {
        return this.parent.bus;
    }

    getValue() {
        const ly = this.parent.LY.getValue();
        const lyc = this.parent.LYC.getValue();
        const coincidence = (ly === lyc) ? 1 : 0;
        const mode = this.parent.mode;
        return 0x80 | (super.getValue() & 0x78) | (coincidence << 2) | mode;
    }

    setValue(value) {
        super.setValue(value & 0x78);
        this.parent.updateStat();
    }
}
class DMAregister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }

    get bus() {
        return this.parent.bus;
    }

    setValue(value) {
        super.setValue(value);
        const source = value << 8;

        for (let i = 0; i <= 0x9F; i++) {
            this.bus.ppuWrite(0xFE00 + i, this.bus.ppuRead(source + i))
        }
    }
}

export default function(machine) {
    class PPU {
        constructor() {
            this.machine = machine;
            this.LY = new LYregister(this);
            this.LCDC = new LCDCregister(this);
            this.STAT = new STATregister(this);
            this.SCY = new (Register(8));
            this.SCX = new (Register(8));
            this.LYC = new LYCregister(this);
            this.DMA = new DMAregister(this);
            this.BGP = new (Register(8));
            this.OBP0 = new (Register(8));
            this.OBP1 = new (Register(8));
            this.WY = new (Register(8));
            this.WX = new (Register(8));


            this.line = 0;
            this.mode = 2;

            this.screen = new Uint8Array(160 * 144);
            this.windowLine = 0;
            this.bgLine = new Uint8Array(160);
            this.remain = this.duration(this.mode);
            this.lastSeen = 0;

            this.statLine = 0;

            this.lcdJustOn = false;
            this.mode3Penality = 0;
        }

        sleep() {
            this.screen.fill(0);
        }

        wake() {
            this.line = 0;
            this.mode = 0;
            this.remain = this.duration(2);
            this.lcdJustOn = true;
            this.lastSeen = this.totalMachineCycles;
            this.statLine = 0;
        }

        get bus() {
            const self = this;
            return {
                ppuRead(addr) {
                    return self.machine.memory._read(addr);
                },
                ppuWrite(addr, value) {
                    return self.machine.memory._write(addr, value);
                }
            }
        }
        
        get totalMachineCycles() {
            return this.machine.totalCycles;
        }

        get registersMapping() {
            return {
                0xFF40: this.LCDC,
                0xFF41: this.STAT,
                0xFF42: this.SCY,
                0xFF43: this.SCX,
                0xFF44: this.LY,
                0xFF45: this.LYC,
                0xFF46: this.DMA,
                0xFF47: this.BGP,
                0xFF48: this.OBP0,
                0xFF49: this.OBP1,
                0xFF4A: this.WY,
                0xFF4B: this.WX,
            }
        }

        renderWindow(line) {
            const startX = this.WX.getValue() - 7;
            const card = byte.getFlag(this.LCDC.getValue(), 6) ? 0x9C00 : 0x9800;
            const wrow = this.windowLine;

            for (let x = 0; x < 160; x++) {
                if (x < startX) continue;
                const wx = x - startX;
                const id = this.bus.ppuRead(card + (wrow >> 3) * 32 + (wx >> 3));
                const tile = byte.getFlag(this.LCDC.getValue(), 4) ?
                    0x8000 + id * 16 :
                    0x9000 + byte.sign8(id) * 16;
                const low = this.bus.ppuRead(tile + (wrow & 7) * 2);
                const high = this.bus.ppuRead(tile + (wrow & 7) * 2 + 1);
                const bit = 7 - (wx & 7)
                const teinte = byte.getBit(high, bit) * 2 + byte.getBit(low, bit);
                this.bgLine[x] = teinte;
                this.screen[line * 160 + x] = (this.BGP.getValue() >> (teinte * 2)) & 0b11;
            }
        }

        renderSprites(line) {
            const h = byte.getFlag(this.LCDC.getValue(), 2) ? 16 : 8;

            let visibles = [];

            for (let i = 0; i < 40 && visibles.length < 10; i++) {
                const addr = 0xFE00 + i * 4;
                const y = this.bus.ppuRead(addr) - 16;

                if (line >= y && line < y + h) {
                    visibles.push({
                        y,
                        x: this.bus.ppuRead(addr+1)-8,
                        index:i,
                        tile: this.bus.ppuRead(addr+2),
                        attrs: this.bus.ppuRead(addr+3)
                    })
                }
            }

            visibles = visibles.sort(
                function(a, b) {
                    return (b.x - a.x) || (b.index - a.index);
                }
            )

            for (let sprite of visibles) {
                let row = line - sprite.y;
                if (byte.getFlag(sprite.attrs, 6)) {
                    row = h - 1 - row
                }

                let tile = sprite.tile;
                if (h === 16) {
                    tile = (sprite.tile & 0xFE) + +(row >= 8);
                    row = row & 7;
                }

                const adr = 0x8000 + tile * 16;
                const low = this.bus.ppuRead(adr + row * 2);
                const high = this.bus.ppuRead(adr + row * 2 + 1);
                const palette = byte.getFlag(sprite.attrs, 4) ?
                    this.OBP1 :
                    this.OBP0;
                
                for (let col = 0; col < 8; col++) {
                    const bit = byte.getFlag(sprite.attrs, 5) ? col : 7 - col;
                    const teinte = byte.getBit(high, bit) * 2 + byte.getBit(low, bit);
                    if (teinte === 0) continue;
                    const ex = sprite.x + col;

                    if (ex < 0 || ex >= 160) continue;
                    if (byte.getFlag(sprite.attrs, 7) && this.bgLine[ex] != 0) continue;
                    this.screen[line * 160 + ex] = (palette.getValue() >> (teinte * 2)) & 0b11;
                }
            
            }


        }

        renderLine(line) {
            if (line === 0) this.windowLine = 0;
            if (!byte.getFlag(this.LCDC.getValue(), 0)) return this.screen.fill(0, line * 160, line * 160 + 160);

            for (let x = 0; x <= 159; x++) {
                const dx = (x + this.SCX.getValue()) & 0xFF;
                const dy = (line + this.SCY.getValue()) & 0xFF;
                const card = byte.getFlag(this.LCDC.getValue(), 3) ? 0x9C00 : 0x9800;
                const addr = card + (dy >> 3) * 32 + (dx >> 3);
                const id = this.bus.ppuRead(addr);
                const tile = byte.getFlag(this.LCDC.getValue(), 4) ?
                    0x8000 + id * 16 :
                    0x9000 + byte.sign8(id) * 16;
                const low = this.bus.ppuRead(tile + (dy % 8) * 2);
                const high = this.bus.ppuRead(tile + (dy % 8) * 2 + 1); 
                const bit = 7 - (dx % 8);
                const teinte = byte.getBit(high, bit) * 2 + byte.getBit(low, bit);
                this.bgLine[x] = teinte;
                this.screen[line * 160 + x] = (this.BGP.getValue() >> (teinte * 2)) & 0b11;
            }

            if (byte.getFlag(this.LCDC.getValue(), 5) && line >= this.WY.getValue() && this.WX.getValue() <= 166) {
                this.renderWindow(line);
                this.windowLine++;
            }
            if (byte.getFlag(this.LCDC.getValue(), 1)) this.renderSprites(line);
        }

        fetchLine() {
            this.line++;
            if (this.mode == 1 && this.line >= 154) {
                this.line = 0;
                this.mode = 2;
            }
        }

        updateStat() {
            const LYC = this.LYC.getValue();
            const stat = this.STAT.getValue();

            const level = (this.line === LYC && byte.getFlag(stat, 6)) ||
                        (this.mode === 0 && byte.getFlag(stat, 3)) ||
                        (this.mode === 1 && byte.getFlag(stat, 4)) ||
                        (this.mode === 2 && byte.getFlag(stat, 5)) ||
                        (this.line === 144 && byte.getFlag(stat, 5))
            if (level && !this.statLine) {
                this.machine.IF |= 0b00010;
            }
            this.statLine = level;
        }

        duration(mode) {
            return [204, 456, 80, 172][mode % 4];
        }

        transition() {
            switch (this.mode) {
                case 0:
                    this.mode = 2;
                    if (this.lcdJustOn) {
                        this.lcdJustOn = false;
                        return this.transition();
                    };
                    this.fetchLine();
                    if (this.line >= 144) {
                        this.mode = 1;
                        this.machine.IF |= 0b00001;
                    }
                    break;
                case 1:
                    this.fetchLine();
                    break;
                case 2:
                    this.mode = 3;
                    this.mode3Penality = this.SCX.getValue() & 7;
                    this.renderLine(this.line);
                    break;
                case 3:
                    this.mode = 0;
                    break;
            }

            this.updateStat();

            // Débordement négatif
            let overflow = 0;
            if (this.remain < 0) {
                overflow = this.remain;
            }
            let penality = 0;
            if (this.mode === 0) {
                penality = -this.mode3Penality;
            } 
            if (this.mode === 3) {
                penality = this.mode3Penality;
            } 
            this.remain = this.duration(this.mode) + penality + overflow;
        }

        check() {
            if (!this.LCDC.isOn) return;
            const delta = (this.totalMachineCycles - this.lastSeen) * 4;
            this.lastSeen = this.totalMachineCycles;
            this.remain -= delta;
            while (this.remain <= 0) {                
                this.transition();
            }
        }

        read (addr) {
            return this.registersMapping[addr].getValue();
        };

        write (addr, value) {
            return this.registersMapping[addr].setValue(value);
        };

    }

    return PPU;
}