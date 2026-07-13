import { Register } from "../../lib/register";
import byte from "../../lib/byte";

class LYregister extends Register(8) {
    
    constructor(parent) {
        super();
        this.parent = parent;
    }

    getValue() {
        if (!this.parent.LCDC.isOn) return 0;
        const value = Math.floor((this.parent.totalMachineCycles - this.parent.anchor) / 114) % 154;
        return value;
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
            this.bus.write(0xFE00 + i, this.bus.read(source + i))
        }
    }
}

export default function(machine) {
    class PPU {
        constructor() {
            this.machine = machine;
            this._innerCycles = this.totalMachineCycles; // Almost a bad boy. Whatcha gonna do !!
            this.LY = new LYregister(this);
            this.LCDC = new LCDCregister(this);
            this.STAT = new (Register(8));
            this.SCY = new (Register(8));
            this.SCX = new (Register(8));
            this.LYC = new (Register(8));
            this.DMA = new DMAregister(this);
            this.BGP = new (Register(8));
            this.OBP0 = new (Register(8));
            this.OBP1 = new (Register(8));
            this.WY = new (Register(8));
            this.WX = new (Register(8));

            this.dateAlarme = 0;
            this.anchor = this.totalMachineCycles;
            this.screen = new Uint8Array(160 * 144);
            this.windowLine = 0;
        }

        sleep() {
            this.dateAlarme = Infinity;
            this.screen.fill(0);
        }

        wake() {
            this.anchor = this.totalMachineCycles;
            this.dateAlarme = this.anchor;
        }

        get bus() {
            return this.machine.cpu.memory;
        }

        get innerCycles() {
            return this.totalMachineCycles - this._innerCycles;
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
                const id = this.bus.read(card + (wrow >> 3) * 32 + (wx >> 3));
                const tile = byte.getFlag(this.LCDC.getValue(), 4) ?
                    0x8000 + id * 16 :
                    0x9000 + byte.sign8(id) * 16;
                const low = this.bus.read(tile + (wrow & 7) * 2);
                const high = this.bus.read(tile + (wrow & 7) * 2 + 1);
                const bit = 7 - (wx & 7)
                const teinte = byte.getBit(high, bit) * 2 + byte.getBit(low, bit);
                this.screen[line * 160 + x] = (this.BGP.getValue() >> (teinte * 2)) & 0b11;
            }
        }

        renderSprites(line) {
            const h = byte.getFlag(this.LCDC.getValue(), 2) ? 16 : 8;

            let visibles = [];

            for (let i = 0; i < 40 && visibles.length < 10; i++) {
                const addr = 0xFE00 + i * 4;
                const y = this.bus.read(addr) - 16;

                if (line >= y && line < y + h) {
                    visibles.push({
                        y,
                        x: this.bus.read(addr+1)-8,
                        index:i,
                        tile: this.bus.read(addr+2),
                        attrs: this.bus.read(addr+3)
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
                const low = this.bus.read(adr + row * 2);
                const high = this.bus.read(adr + row * 2 + 1);
                const palette = byte.getFlag(sprite.attrs, 4) ?
                    this.OBP1 :
                    this.OBP0;
                
                for (let col = 0; col < 8; col++) {
                    const bit = byte.getFlag(sprite.attrs, 5) ? col : 7 - col;
                    const teinte = byte.getBit(high, bit) * 2 + byte.getBit(low, bit);
                    if (teinte === 0) continue;
                    const ex = sprite.x + col;

                    if (ex < 0 || ex >= 160) continue;
                    if (byte.getFlag(sprite.attrs, 7) && this.screen[line * 160 + ex] != 0) continue;
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
                const id = this.bus.read(addr);
                const tile = byte.getFlag(this.LCDC.getValue(), 4) ?
                    0x8000 + id * 16 :
                    0x9000 + byte.sign8(id) * 16;
                const low = this.bus.read(tile + (dy % 8) * 2);
                const high = this.bus.read(tile + (dy % 8) * 2 + 1); 
                const bit = 7 - (dx % 8);
                const teinte = byte.getBit(high, bit) * 2 + byte.getBit(low, bit);
                this.screen[line * 160 + x] = (this.BGP.getValue() >> (teinte * 2)) & 0b11;
            }

            if (byte.getFlag(this.LCDC.getValue(), 5) && line >= this.WY.getValue()) {
                this.renderWindow(line);
                this.windowLine++;
            }
            if (byte.getFlag(this.LCDC.getValue(), 1)) this.renderSprites(line);
        }

        check() {
            while (this.totalMachineCycles >= this.dateAlarme) {
                const line = Math.floor((this.dateAlarme - this.anchor) / 114) % 154
                if (line === 144) {
                    this.machine.IF |= 0b00001;

                } else if (line < 144) {
                    this.renderLine(line);
                }
                this.dateAlarme += 114;
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