import byte from "../../lib/byte.js";
import { Register, FlagRegister, Extendedregister } from "../../lib/register.js";

class MemoryWrapper {
    constructor(cpu, memory) {
        this._memory = memory;
        this.cpu = cpu;
    }

    write(address, value) {
        const r = this._memory.write(address, value);
        this.pay(1);
        return r;
    }

    read(address) {
        const r = this._memory.read(address);
        this.pay(1);
        return r;
    }

    pay(n) {
        this.cpu.pay(n);
    }
}

class CPUFlagRegister extends FlagRegister(8) {
    constructor() {
        super({
            "C": { "offset": 4 },
            "H": { "offset": 5 },
            "N": { "offset": 6 },
            "Z": { "offset": 7 },
        })
    }
}

class Stack {
    constructor(memory, pointer) {
        this.pointer = pointer; // U16 Register implementation
        this.memory = memory; // CPUMemory implementation
    }

    _push(byte) {
        this.pointer.decrement();
        this.memory.write(this.pointer.getValue(), byte);
    }
    _pop(byte) {
        const value = this.memory.read(this.pointer.getValue());
        this.pointer.increment();
        return value;
    }

    push(value) {
        const { high, low } = byte.U16to2U8(value?.getValue ? value.getValue() : value);
        this._push(high);
        this._push(low);
    }

    pop() {
        const low = this._pop();
        const high = this._pop();
        return byte.buildU16(high, low);
    }
    
}
class CPURegister {
    constructor() {
        this.A = new (Register(8));
        this.F = new CPUFlagRegister(8);
        this.B = new (Register(8));
        this.C = new (Register(8));
        this.D = new (Register(8));
        this.E = new (Register(8));
        this.H = new (Register(8));
        this.L = new (Register(8));

        this.AF = new Extendedregister(this.A, this.F);
        this.BC = new Extendedregister(this.B, this.C);
        this.DE = new Extendedregister(this.D, this.E);
        this.HL = new Extendedregister(this.H, this.L);

        this.SP = new (Register(16));
        this.PC = new (Register(16));

    }
}

export default class CPU {
    constructor(memory) {
        this.registers = new CPURegister();
        this.initMemory(memory);
        this._ime = false;
        this._imeScheduled = false;
        this._halt = false;
        this._stopped = false;
        this.cycles = 0;

        this._cyclesUpdateObservers = [];
    }

    get ime() {
        return this._ime;
    }
    get imeScheduled() {
        return this._imeScheduled;
    }
    get halted() {
        return this._halt;
    }
    get stopped() {
        return this._stopped;
    }

    postBoot() {
        this.registers.PC.setValue(0x100);
        this.registers.SP.setValue(0xFFFE);
        this.registers.AF.setValue(0x1B0);
        this.registers.BC.setValue(0x13);
        this.registers.DE.setValue(0xD8);
        this.registers.HL.setValue(0x14D);
    }

    initMemory(memory) {
        this.memory = new MemoryWrapper(this, memory);
        this.stack = new Stack(this.memory, this.registers.SP);
    }

    resetCycles() {
        this.cycles = 0;
        this._emitCyclesUpdate({type: "set", value: 0});
    }

    di() {
        this._ime = false;
        this._imeScheduled = false;
    }

    start() {
        this._ime = true;
        this._imeScheduled = false;
    }
    
    ei() {
        this._imeScheduled = true;
    }

    halt() {
        this._halt = true;
    }
    wake() {
        this._halt = false;
    }

    stop(n8) {
        
        this._stopped = true;
    }

    updateZeroFlag(value) {
        this.registers.F.Z = +(value === 0);
        return this;
    }

    updateCarryFlag(operation) {
        const { raw, size, ...__ } = operation;
        const highLimit = 2 ** size - 1;
        this.registers.F.C = +(raw < 0 || raw > highLimit);
        return this;

    }

    updateNFlag(operation) {
        this.registers.F.N = operation.id;
        return this;
    }

    updateHFlag(operation, carry=0) {
        const { id, a, b, size} = operation;
        const border = size === 8 ? 0xf : 0xfff;
        const aNible = a & border;
        const bNible = b & border;
        if (id === 0) {
            this.registers.F.H = +((aNible + bNible + carry) > border);
        } else {
            this.registers.F.H = +(aNible < (bNible + carry));
        }
        return this;
    }

    updateNAndHFlags(operation, carry) {
        this.updateNFlag(operation);
        this.updateHFlag(operation, carry);
        return this;

    }

    pay(n) {
        this.cycles += n;
        this._emitCyclesUpdate({type: "add", value: n});
    }

    _emitCyclesUpdate(n) {
        for (let ob of this._cyclesUpdateObservers) {
            ob.call(null, this, n);
        }
    }

    onCyclesUpdate(cb) {
        if (cb && typeof cb === "function") {
            this._cyclesUpdateObservers.push(cb);
        }
    }
}