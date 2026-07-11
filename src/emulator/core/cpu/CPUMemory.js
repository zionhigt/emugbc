/**
 * 
 * @returns Default raw memory
 */
export default function() {
    class Memory {
        constructor() {
            this.ram = new Uint8Array(0x10000)
        }

        write(address, value) {
            this.ram[address] = value;
        }

        read(address) {
            return this.ram[address];
        }
    }

    return Memory;
}