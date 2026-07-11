export default class NoMBC {
    constructor(rom) {
        this.rom = rom;
    }

    read() {
        return this.rom.read.apply(this.rom, arguments);
    }

    write(addr, value) {
        // return this.rom.write();
    }
}