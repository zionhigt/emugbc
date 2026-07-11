import byte from "../../lib/byte.js";

const ROM_SIZE_CONFIG = {
    0x00: {
        iBSize: 32 * 1024,
        banks: 2,
    },
    0x01: {
        iBSize: 64 * 1024,
        banks: 4,
    },
    0x02: {
        iBSize: 128 * 1024,
        banks: 8,
    },
    0x03: {
        iBSize: 256 * 1024,
        banks: 16,
    },
    0x04: {
        iBSize: 512 * 1024,
        banks: 32,
    },
    0x05: {
        iBSize: 1 * 1048576,
        banks: 64,
    },
    0x06: {
        iBSize: 2 * 1048576,
        banks: 128,
    },
    0x07: {
        iBSize: 4 * 1048576,
        banks: 256,
    },
    0x08: {
        iBSize: 8 * 1048576,
        banks: 512,
    },
    0x52: {
        iBSize: 1.1 * 1048576,
        banks: 72,
    },
    0x53: {
        iBSize: 1.2 * 1048576,
        banks: 80,
    },
    0x54: {
        iBSize: 1.5 * 1048576,
        banks: 96,
    },
}

function byteArrayToText(bytes) {
    let s = "";
    for (let n of bytes) {
        if (s.length && n === 0) break;
        s += String.fromCharCode(n)
    }
    return s.trim();
}

class Rom {
    constructor(raw) {
        this._raw = raw;
    }

    getRange(start, end) {
        // Includes end address
        if (!start && !end) return this._raw;
        if (!end) {
            end = this._raw.length;
        } else {
            end++;
        }

        if (!start) start  = 0;
        return this._raw.slice(start, end);
    }

    read(addr) {
        return this._raw[addr];
    }

    get length() {
        return this._raw.length;
    }

}


class CartridgeHeader {
    constructor(rom) {
        this.rom = rom;
        this._raw_entry_point = this.rom.getRange(0x100, 0x103);
        this._raw_nin_logo = this.rom.getRange(0x104, 0x133);
        this._raw_title = this.rom.getRange(0x134, 0x143);
        this._raw_manuf_code = this.rom.getRange(0x13F, 0x142);
        this._raw_cgb_flag = this.rom.read(0x143);
        this._raw_nin_licensee_code = this.rom.getRange(0x144, 0x145);
        this._raw_sgb_flag = this.rom.read(0x146);
        this._raw_cartridge_type = this.rom.read(0x147);
        this._raw_rom_size = this.rom.read(0x148);
        this._raw_ram_size = this.rom.read(0x149);
        this._raw_dest_code = this.rom.read(0x14A);
        this._raw_old_licensee_code = this.rom.read(0x14B);
        this._raw_mask_rom_v_num = this.rom.read(0x14C);
        this._raw_header_checksum = this.rom.read(0x14D);
        this._raw_global_checksum = byte.buildU16(this.rom.read(0x14E), this.rom.read(0x14F));

        this._title = null;

        console.log("Start : " + this.title);
    }

    getRange(start, end) {
        return this.rom.getrange(start, end);
    }

    read(addr) {
        return this.rom.read(addr)
    }

    get title() {
        if (!this._title) {
            this._title = byteArrayToText(this._raw_title);
        }
        return this._title; 
    }

    get type() {
        return this._raw_cartridge_type;
    }

    get romSize() {
        return ROM_SIZE_CONFIG[this._raw_rom_size].iBSize;
    }

    get logoValid() {
        const match = new Uint8Array([
            0xCE, 0xED, 0x66, 0x66, 0xCC, 0x0D, 0x00, 0x0B, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0C, 0x00, 0x0D,
            0x00, 0x08, 0x11, 0x1F, 0x88, 0x89, 0x00, 0x0E, 0xDC, 0xCC, 0x6E, 0xE6, 0xDD, 0xDD, 0xD9, 0x99,
            0xBB, 0xBB, 0x67, 0x63, 0x6E, 0x0E, 0xEC, 0xCC, 0xDD, 0xDC, 0x99, 0x9F, 0xBB, 0xB9, 0x33, 0x3E,
        ])
        for (let i = 0; i < this._raw_nin_logo.length; i++) {
            if (this._raw_nin_logo[i] !== match[i]) return false;
        }
        return true;
    }

    get headerChecksumValid() {
        const cs = this._raw_header_checksum;
        return cs === this._computeHeaderCheckSum();
    }
    get globalChecksumValid() {
        const cs = this._raw_global_checksum;
        return cs === this._computeGlobalCheckSum();
    }

    _computeHeaderCheckSum() {
        let r = 0;
        for (let i = 0x134; i <= 0x14C; i++) {
            const byte = this.rom.read(i);
            r -= (byte + 1);
        }
        return r & 0xff;
    }

    _computeGlobalCheckSum() {
        let r = 0;
        for (let i = 0; i < this.rom.length; i++) {
            if ([0x14E, 0x14F].includes(i)) continue;
            const byte = this.rom.read(i);
            r += byte;
        }
        return r & 0xffff;
    }
}

export default function() {
    class CartRidge {
        constructor(bytes) {
            this._raw = bytes;
            this.rom = new Rom(bytes);
            this._header = new CartridgeHeader(this.rom); //this._raw.slice(0x0100, 0x014F + 1));
        }
        get header() {
            return this._header;
        }
        read(addr) {
            return this._raw[addr];
        }
        write() {}
    }



    return CartRidge;
}