import { Register } from "../../lib/register";
import byte from "../../lib/byte";

class LYregister extends Register(8) {
    
    constructor(parent) {
        super();
        this.parent = parent;
    }

    getValue() {
        if (!this.parent.LCDC.isOn) return 0;
        return this.parent.computeState(this.parent.totalMachineCycles, 4).line;
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
        const coincidence = this.parent.coincidence;
        const mode = this.parent.LCDC.isOn ?
                this.parent.computeState(this.parent.totalMachineCycles, 3).mode :
                0;
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

class Fetcher {
    constructor(parent) {
        this.fifo = [];
        this.step = 0;
        this.fetchX = 0;
        this.id = null;
        this.low = 0;
        this.high = 0;
        this.x = 0;
        this.dy = 0;
        this.parent = parent;
        this.discard = 0;
    }

    tick(line) {
        const dy = this.dy;
        const card = byte.getFlag(this.parent.LCDC.getValue(), 3) ? 0x9C00 : 0x9800;
        const addr = card + (dy >> 3) * 32 + (this.fetchX & 31);
        let tile;
        switch (this.step) {
            case 0:
                this.id = this.parent.bus.ppuRead(addr);
                this.step = 1;
                break;
            case 1:
                tile = byte.getFlag(this.parent.LCDC.getValue(), 4) ?
                    0x8000 + this.id * 16 :
                    0x9000 + byte.sign8(this.id) * 16;
                this.low = this.parent.bus.ppuRead(tile + (dy % 8) * 2);
                this.step = 2;
                break;
            case 2:
                tile = byte.getFlag(this.parent.LCDC.getValue(), 4) ?
                    0x8000 + this.id * 16 :
                    0x9000 + byte.sign8(this.id) * 16;
                this.high = this.parent.bus.ppuRead(tile + (dy % 8) * 2 + 1);
                this.step = 3;
                break;
            case 3:
                if (this.fifo.length === 0) {
                    for (let bit = 7; bit >= 0; bit--) {
                        const teinte = byte.getBit(this.high, bit) * 2 + byte.getBit(this.low, bit);
                        this.fifo.push(teinte);
                    }
                    this.fetchX++;
                    this.step = 0;
                }
                break;
        }
        if (this.fifo.length > 0) {
            if (this.discard > 0) {
                this.fifo.shift();
                this.discard--;
                return;
            }
            const pixel = this.fifo.shift();
            this.parent.bgLine[this.x] = pixel;
            this.parent.screen[line * 160 + this.x] = (this.parent.BGP.getValue() >> (pixel * 2)) & 0b11;
            this.x++;
        }

    }

    renderFifo(line) {
        if (line === 0) this.parent.windowLine = 0;
        if (!byte.getFlag(this.parent.LCDC.getValue(), 0)) return this.parent.screen.fill(0, line * 160, line * 160 + 160);
        const scx = this.parent.SCX.getValue();
        this.fifo = [];
        this.fetchX = scx >> 3;
        this.step = 0;
        this.x = 0;
        this.discard = scx & 7;
        this.dy = (line + this.parent.SCY.getValue()) & 0xFF;
        while (this.x < 160) {
            this.tick(line);
        }

        if (byte.getFlag(this.parent.LCDC.getValue(), 5) && line >= this.parent.WY.getValue() && this.parent.WX.getValue() <= 166) {
            this.parent.renderWindow(line);
            this.parent.windowLine++;
        }
        if (byte.getFlag(this.parent.LCDC.getValue(), 1)) this.parent.renderSprites(line);
        
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
            this.origin = 0;

            this.statLine = 0;

            this.lcdJustOn = false;
            this.mode3Penality = 0;
            this._visibleLineSprites = {};

            this.coincidence = 0;

            this.fetcher = new Fetcher(this);
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
            this.origin = this.totalMachineCycles;
            this.updateStat();
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

        visibleLineSprites(line) {

            if (line in (this._visibleLineSprites || {})) return this._visibleLineSprites[line];
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
            this._visibleLineSprites = {[line]: visibles};
            return this._visibleLineSprites[line];
        }

        computeOAMPenality(line) {
            let penality = 0;
            if (byte.getFlag(this.LCDC.getValue(), 1)) {
                const visibles = this.visibleLineSprites(line);
                const tmp = [];
                const scx = this.SCX.getValue();
                for (let o of Object.values(visibles)) {
                    if (o.x >= 160) continue;
                    if (!tmp.includes(o.x)) {
                        tmp.push(o.x);
                        if (o.x === -8) penality += 5;
                        else penality += Math.max(0, 5 - ((o.x + scx) & 7));
                    };
                    penality += 6;
                }
            }

            return penality;

        }

        renderSprites(line) {
            const h = byte.getFlag(this.LCDC.getValue(), 2) ? 16 : 8;
            for (let sprite of this.visibleLineSprites(line)) {
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
            return this.fetcher.renderFifo(line);
        }

        fetchLine() {
            this.line++;
            if (this.mode == 1 && this.line >= 154) {
                this.line = 0;
                this.mode = 2;
            }
        }

        updateStat() {
            if (!this.LCDC.isOn) return;
            const LYC = this.LYC.getValue();
            const stat = this.STAT.getValue();
            this.coincidence = (this.line === LYC) ? 1 : 0;
            const { line, mode } = this;
            const level = (this.coincidence && byte.getFlag(stat, 6)) ||
                        (mode === 0 && byte.getFlag(stat, 3)) ||
                        (mode === 1 && byte.getFlag(stat, 4)) ||
                        (mode === 2 && byte.getFlag(stat, 5)) ||
                        (line === 144 && byte.getFlag(stat, 5))
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
                    this.mode3Penality += this.computeOAMPenality(this.line);
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

        computeState(cycle = this.totalMachineCycles, dotOffset=0) {
            let mode;
            const elapsedDots = 4 * (cycle - this.origin) + dotOffset;
            const frameDot    = elapsedDots % 70224;
            const line        = Math.floor(frameDot / 456);
            const dotInLine   = frameDot % 456;
            const len         = 172 + (this.SCX.getValue() & 7) + this.computeOAMPenality(line);
            if      (line >= 144)          mode = 1;
            else if (dotInLine < 80)       mode = 2;
            else if (dotInLine < 80 + len) mode = 3;
            else                           mode = 0;

            if (elapsedDots < 456) {
                if (dotInLine < 80) mode = 0;
            }

            return { line, mode };
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