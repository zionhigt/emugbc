import byte from "../../lib/byte";

const instructions = {

}

/**
 * 
 * @param {*} id 
 * @param {*} cycle: int | Array(taken, untaken) 
 * @param {*} bytes 
 * @param {*} run 
 */
function buildInstruction(id, cycle, bytes, run) {
    let untaken = cycle;
    let taken = untaken
    if (Array.isArray(cycle) && cycle.length === 2) {
        [ taken, untaken ] = cycle;
    }
    instructions[id] = {
        id, cycle: untaken, extraCycle: taken - untaken, bytes,
        run() { return run.apply(this, ...[arguments]) }
    }
}

function ADC(cpu, a, b, c, size) {
    const raw = a + b + c;
    cpu.registers.A.setValue(raw);
    const value = cpu.registers.A.getValue();
    const operation = {
        size: size,
        id: 0,
        a: a,
        b: b,
        raw: raw,
    }
    cpu
    .updateZeroFlag(value)
    .updateNAndHFlags(operation, c)
    .updateCarryFlag(operation);
}

function matchCC(cpu, cc) {
    let match = false;
    switch (cc) {
        case "Z":
            match = cpu.registers.F.Z;
            break;
        case "NZ":
            match = !cpu.registers.F.Z;
            break;
        case "C":
            match = cpu.registers.F.C;
            break;
        case "NC":
            match = !cpu.registers.F.C;
            break;
    }
    return match;
}


function CPA(cpu, a, b) {
    const raw = a - b;
    const operation = {
        id: 1,
        size: 8,
        a, b,
        raw: raw,
    }
    cpu
    .updateZeroFlag(raw)
    .updateNAndHFlags(operation)
    .updateCarryFlag(operation)
}

export default function() {
    //------------------ ARITHMETIQUE -------------------------------
    function ADC(cpu, a, b, c, size) {
        const raw = a + b + c;
        cpu.registers.A.setValue(raw);
        const value = cpu.registers.A.getValue();
        const operation = {
            size: size,
            id: 0,
            a: a,
            b: b,
            raw: raw,
        }
        cpu
        .updateZeroFlag(value)
        .updateNAndHFlags(operation, c)
        .updateCarryFlag(operation);
    }
    function SBC(cpu, a, b, c, size) {
        const raw = a - b - c;
        cpu.registers.A.setValue(raw);
        const value = cpu.registers.A.getValue();
        const operation = {
            size: size,
            id: 1,
            a: a,
            b: b,
            raw: raw,
        }
        cpu
        .updateZeroFlag(value)
        .updateNAndHFlags(operation, c)
        .updateCarryFlag(operation);
    }
    buildInstruction("ADC_A_r8", 1, 1, function(cpu, reg8) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        return ADC(cpu, a, r8, c, 8);
    });
    buildInstruction("ADC_A_HL", 2, 1, function(cpu) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        return ADC(cpu, a, r8, c, 8);
    });
    buildInstruction("ADC_A_n8", 2, 2, function(cpu, n8) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        return ADC(cpu, a, n8, c, 8);
    });
    buildInstruction("SBC_A_r8", 1, 1, function(cpu, reg8) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        return SBC(cpu, a, r8, c, 8);
    });
    buildInstruction("SBC_A_HL", 2, 1, function(cpu) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        return SBC(cpu, a, r8, c, 8);
    });
    buildInstruction("SBC_A_n8", 2, 2, function(cpu, n8) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        return SBC(cpu, a, n8, c, 8);
    });

    buildInstruction("SUB_A_r8", 1, 1, function(cpu, reg8) {
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        return SBC(cpu, a, r8, 0, 8);
    });
    buildInstruction("SUB_A_HL", 2, 1, function(cpu) {
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        return SBC(cpu, a, r8, 0, 8);
    });
    buildInstruction("SUB_A_n8", 2, 2, function(cpu, n8) {
        const a = cpu.registers.A.getValue();
        return SBC(cpu, a, n8, 0, 8);
    });

    buildInstruction("ADD_A_r8", 1, 1, function(cpu, reg8) {
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        return ADC(cpu, a, r8, 0, 8);
    });
    buildInstruction("ADD_A_HL", 2, 1, function(cpu) {
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        return ADC(cpu, a, r8, 0, 8);
    });
    buildInstruction("ADD_A_n8", 2, 2, function(cpu, n8) {
        const a = cpu.registers.A.getValue();
        return ADC(cpu, a, n8, 0, 8);
    });
    
    buildInstruction("ADD_HL_r16", 2, 1, function(cpu, r16) {
        const hl = cpu.registers.HL.getValue();
        const b = r16.getValue();
        const raw = hl + b;
        cpu.registers.HL.setValue(raw);
        const operation = {
            id: 0,
            size: 16,
            a: hl,
            b: b,
            raw: raw,

        }
        return cpu
        .updateNAndHFlags(operation)
        .updateCarryFlag(operation);
    });
    buildInstruction("ADD_HL_SP", 2, 1, function(cpu) {
        const hl = cpu.registers.HL.getValue();
        const b = cpu.registers.SP.getValue();
        const raw = hl + b;
        cpu.registers.HL.setValue(raw);
        const operation = {
            id: 0,
            size: 16,
            a: hl,
            b: b,
            raw: raw,

        }
        return cpu
        .updateNAndHFlags(operation)
        .updateCarryFlag(operation);
    });
    buildInstruction("ADD_SP_e8", 4, 2, function(cpu, e8) {
        const sp = cpu.registers.SP.getValue();
        const a = byte.U16to2U8(sp).low;
        const b = byte.sign8(e8);
        const raw = sp + b;
        cpu.registers.SP.setValue(raw);
        const operation = {
            id: 0,
            size: 8,
            a: a,
            b: e8,
            raw: a + e8,

        }
        cpu.registers.F.Z = 0;
        return cpu
        .updateNAndHFlags(operation)
        .updateCarryFlag(operation);
    });

    //------------------ LOGIC -------------------------------
    
    function AND(cpu, a, b) {
        const raw = a & b;
        cpu.registers.A.setValue(raw);
        const value = cpu.registers.A.getValue();
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 1;
        cpu.registers.F.C = 0;
    }
    function OR(cpu, a, b) {
        const raw = a | b;
        cpu.registers.A.setValue(raw);
        const value = cpu.registers.A.getValue();
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
        cpu.registers.F.C = 0;
    }
    function XOR(cpu, a, b) {
        const raw = a ^ b;
        cpu.registers.A.setValue(raw);
        const value = cpu.registers.A.getValue();
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
        cpu.registers.F.C = 0;
    }

    buildInstruction("AND_A_r8", 1, 1, function(cpu, reg8) {
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        AND(cpu, a, r8)
    });
    buildInstruction("AND_A_HL", 2, 1, function(cpu) {
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        AND(cpu, a, r8)
    });
    buildInstruction("AND_A_n8", 2, 2, function(cpu, n8) {
        const a = cpu.registers.A.getValue();
        AND(cpu, a, n8)
    });
    buildInstruction("OR_A_r8", 1, 1, function(cpu, reg8) {
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        OR(cpu, a, r8)
    });
    buildInstruction("OR_A_HL", 2, 1, function(cpu) {
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        OR(cpu, a, r8)
    });
    buildInstruction("OR_A_n8", 2, 2, function(cpu, n8) {
        const a = cpu.registers.A.getValue();
        OR(cpu, a, n8)
    });
    buildInstruction("XOR_A_r8", 1, 1, function(cpu, reg8) {
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        XOR(cpu, a, r8)
    });
    buildInstruction("XOR_A_HL", 2, 1, function(cpu) {
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        XOR(cpu, a, r8)
    });
    buildInstruction("XOR_A_n8", 2, 2, function(cpu, n8) {
        const a = cpu.registers.A.getValue();
        XOR(cpu, a, n8)
    });

    //------------------ BIT -------------------------------
    buildInstruction("BIT_u3_r8", 2, 2, function(cpu, u3, reg8) {
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        cpu.registers.F.Z = +(!byte.getFlag(r8, u3));
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 1;
    });
    buildInstruction("BIT_u3_HL", 3, 2, function(cpu, u3) {
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        cpu.registers.F.Z = +(!byte.getFlag(r8, u3));
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 1;
    });
    //------------------ CALL -------------------------------
    buildInstruction("CALL_n16", 6, 3, function(cpu, n16) {
        cpu.stack.push(cpu.registers.PC.getValue());
        cpu.registers.PC.setValue(n16);
    });
    buildInstruction("CALL_cc_n16", [6, 3], 3, function(cpu, cc, n16) {
        
        if (matchCC(cpu, cc)) {
            cpu.stack.push(cpu.registers.PC.getValue());
            cpu.registers.PC.setValue(n16);
            cpu.cycles += this.extraCycle;
        }
    });
    //------------------ CARRY -------------------------------

    buildInstruction("CCF", 1, 1, function(cpu, n16) {
        cpu.registers.F.C = +!cpu.registers.F.C
        cpu.registers.F.H = 0;
        cpu.registers.F.N = 0;
    });
    
    //------------------ COMPARE -------------------------------

    buildInstruction("CP_A_r8", 1, 1, function(cpu, reg8) {
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        return CPA(cpu, a, r8);
    });

    buildInstruction("CP_A_HL", 2, 1, function(cpu) {
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        return CPA(cpu, a, r8);
    });
    buildInstruction("CP_A_n8", 2, 2, function(cpu, n8) {
        const a = cpu.registers.A.getValue();
        return CPA(cpu, a, n8);
    });

    //------------------ BITWISE NOT -------------------------------
    buildInstruction("CPL", 1, 1, function(cpu) {
        const a = byte.revertBits(cpu.registers.A.getValue());
        cpu.registers.A.setValue(a);
        cpu.registers.F.N = 1;
        cpu.registers.F.H = 1;
    });
    //------------------ DECIMAL -------------------------------
    buildInstruction("DAA", 1, 1, function(cpu) {
        const n = cpu.registers.F.N;
        const h = cpu.registers.F.H;
        const c = cpu.registers.F.C;
        let a = cpu.registers.A.getValue();
        let acc = 0;
        if (n) {
            if (h) acc += 0x6;
            if (c) acc += 0x60;
            cpu.registers.A.setValue(a - acc);

        } else {
            if (h || (a & 0xf) > 0x9) acc += 0x6;
            if (c || a > 0x99) {
                acc += 0x60;
                cpu.registers.F.C = 1;
            }
            cpu.registers.A.setValue(a + acc);
        }
        a = cpu.registers.A.getValue();
        cpu.updateZeroFlag(a);
        cpu.registers.F.H = 0;
    });

    //------------------ DECREMENTS -------------------------------

    function DEC8(cpu, reg) {
        const a = reg.getValue();
        const raw = a - 1;
        reg.decrement();
        const operation = {
            id: 1,
            a, b: 1,
            size: 8,
            raw,
        }
        cpu
        .updateZeroFlag(raw)
        .updateNAndHFlags(operation)
    }
    function DEC16(reg) {
        reg.decrement();
    }

    buildInstruction("DEC_r8", 1, 1, function(cpu, r8) {
        return DEC8(cpu, r8);
    });
    buildInstruction("DEC_HL", 3, 1, function(cpu) {
        const hl = cpu.registers.HL.getValue();
        const a = cpu.memory.read(hl);
        const raw = a - 1;
        cpu.memory.write(hl, raw);
        const operation = {
            id: 1,
            a, b: 1,
            size: 8,
            raw,
        }
        cpu
        .updateZeroFlag(raw)
        .updateNAndHFlags(operation)
    });
    buildInstruction("DEC_r16", 2, 1, function(cpu, r16) {
        return DEC16(r16);
    });
    buildInstruction("DEC_SP", 2, 1, function(cpu) {
        return DEC16(cpu.registers.SP);
    });
    //------------------ INCREMENTS -------------------------------

    function INC8(cpu, reg) {
        const a = reg.getValue();
        const raw = a + 1;
        reg.increment();
        const operation = {
            id: 0,
            a, b: 1,
            size: 8,
            raw,
        }
        cpu
        .updateZeroFlag(reg.getValue())
        .updateNAndHFlags(operation)
    }
    function INC16(reg) {
        reg.increment();
    }

    buildInstruction("INC_r8", 1, 1, function(cpu, r8) {
        return INC8(cpu, r8);
    });
    buildInstruction("INC_HL", 3, 1, function(cpu) {
        const hl = cpu.registers.HL.getValue();
        const a = cpu.memory.read(hl);
        const raw = a + 1;
        cpu.memory.write(hl, raw);
        const operation = {
            id: 0,
            a, b: 1,
            size: 8,
            raw,
        }
        cpu
        .updateZeroFlag(cpu.memory.read(hl))
        .updateNAndHFlags(operation)
    });
    buildInstruction("INC_r16", 2, 1, function(cpu, r16) {
        return INC16(r16);
    });
    buildInstruction("INC_SP", 2, 1, function(cpu) {
        return INC16(cpu.registers.SP);
    });

    //------------------ INTERRUPT -------------------------------
    buildInstruction("DI", 1, 1, function(cpu) {
        return cpu.di();
    });
    buildInstruction("EI", 1, 1, function(cpu) {
        return cpu.ei();
    });
    buildInstruction("HALT", 1, 1, function(cpu) {
        return cpu.halt();
    });
    buildInstruction("STOP", -1, 2, function(cpu, n8) {
        return cpu.stop(n8);
    });

    //------------------ JUMP -------------------------------
    buildInstruction("JP_n16", 4, 3, function(cpu, n16) {
        cpu.registers.PC.setValue(n16);
    });
    buildInstruction("JP_cc_n16", [4, 3], 3, function(cpu, cc, n16) {
        if (matchCC(cpu, cc)) {
            cpu.registers.PC.setValue(n16);
            cpu.cycles += this.extraCycle;
        }
    });
    buildInstruction("JP_HL", 1, 1, function(cpu) {
        const hl = cpu.registers.HL.getValue();
        cpu.registers.PC.setValue(hl);
    });
    buildInstruction("JR_n16", 3, 2, function(cpu, n16) {
        const pc = cpu.registers.PC.getValue();
        n16 = pc + byte.sign8(n16);
        cpu.registers.PC.setValue(n16);
    });
    buildInstruction("JR_cc_n16", [3, 2], 2, function(cpu, cc, n16) {
        if (matchCC(cpu, cc)) {
            const pc = cpu.registers.PC.getValue();
            n16 = pc + byte.sign8(n16);
            cpu.registers.PC.setValue(n16);
            cpu.cycles += this.extraCycle;
        }
    });

    //------------------ LOAD -------------------------------
    function LOAD(reg, value) {
        reg.setValue(value);
    }
    buildInstruction("LD_r8_r8", 1, 1, function(cpu, a8, b8) {
        LOAD(a8, b8.getValue());
    });
    buildInstruction("LD_r8_n8", 2, 2, function(cpu, a8, n8) {
        LOAD(a8, n8);
    });
    buildInstruction("LD_r16_n16", 3, 3, function(cpu, a16, n16) {
        LOAD(a16, n16);
    });
    buildInstruction("LD_HL_r8", 2, 1, function(cpu, a8) {
        cpu.memory.write(
            cpu.registers.HL.getValue(),
            a8.getValue()
        );
    });
    buildInstruction("LD_HL_n8", 3, 2, function(cpu, n8) {
        cpu.memory.write(
            cpu.registers.HL.getValue(),
            n8
        );
    });
    buildInstruction("LD_r8_HL", 2, 1, function(cpu, a8) {
        a8.setValue(
            cpu.memory.read(cpu.registers.HL.getValue())
        );
    });
    buildInstruction("LD_r16_A", 2, 1, function(cpu, a8) {
        cpu.memory.write(
            a8.getValue(),
            cpu.registers.A.getValue()
        );
    });
    buildInstruction("LD_n16_A", 4, 3, function(cpu, n16) {
        cpu.memory.write(
            n16,
            cpu.registers.A.getValue()
        );
    });
    buildInstruction("LDH_n16_A", 3, 2, function(cpu, n16) {
        cpu.memory.write(
            0xFF00 | n16,
            cpu.registers.A.getValue()
        );
    });
    buildInstruction("LDH_C_A", 2, 1, function(cpu) {
        cpu.memory.write(
            0xFF00 + cpu.registers.C.getValue(),
            cpu.registers.A.getValue()
        );
    });
    buildInstruction("LD_A_r16", 2, 1, function(cpu, r16) {
        cpu.registers.A.setValue(
            cpu.memory.read(r16.getValue())
        )
    });
    buildInstruction("LD_A_n16", 4, 3, function(cpu, n16) {
        cpu.registers.A.setValue(
            cpu.memory.read(n16)
        )
    });
    buildInstruction("LDH_A_n16", 3, 2, function(cpu, n16) {
        cpu.registers.A.setValue(
            cpu.memory.read(0xFF00 | n16)
        )
    });
    buildInstruction("LDH_A_C", 2, 1, function(cpu) {
        cpu.registers.A.setValue(
            cpu.memory.read(0xFF00 + cpu.registers.C.getValue())
        )
    });
    buildInstruction("LD_HLI_A", 2, 1, function(cpu) {
        cpu.memory.write(
            cpu.registers.HL.getValue(),
            cpu.registers.A.getValue()
        );
        cpu.registers.HL.increment();
    });
    buildInstruction("LD_HLD_A", 2, 1, function(cpu) {
        cpu.memory.write(
            cpu.registers.HL.getValue(),
            cpu.registers.A.getValue()
        );
        cpu.registers.HL.decrement();
    });
    buildInstruction("LD_A_HLD", 2, 1, function(cpu) {
        cpu.registers.A.setValue(
            cpu.memory.read(cpu.registers.HL.getValue())
        );
        cpu.registers.HL.decrement();
    });
    buildInstruction("LD_A_HLI", 2, 1, function(cpu) {
        cpu.registers.A.setValue(
            cpu.memory.read(cpu.registers.HL.getValue())
        );
        cpu.registers.HL.increment();
    });
    buildInstruction("LD_SP_n16", 3, 3, function(cpu, n16) {
        cpu.registers.SP.setValue(n16);
    });
    buildInstruction("LD_n16_SP", 5, 3, function(cpu, n16) {
        cpu.memory.write(
            n16,
            cpu.registers.SP.getValue() & 0xff,
        );
        cpu.memory.write(
            n16 + 1,
            cpu.registers.SP.getValue() >> 8,
        );
    });
    buildInstruction("LD_HL_SP_e8", 3, 2, function(cpu, e8) {
        const sp = cpu.registers.SP.getValue();
        const a = byte.U16to2U8(sp).low;
        const b = byte.sign8(e8);
        const raw = sp + b;
        cpu.registers.HL.setValue(raw);
        const operation = {
            id: 0,
            size: 8,
            a: a,
            b: e8,
            raw: a + e8,

        }
        cpu.registers.F.Z = 0;
        return cpu
        .updateNAndHFlags(operation)
        .updateCarryFlag(operation);
    });
    buildInstruction("LD_SP_HL", 2, 1, function(cpu) {
        LOAD(cpu.registers.SP, cpu.registers.HL.getValue());
    });

    //------------------ NOP -------------------------------

    buildInstruction("NOP", 1, 1, function(cpu) {});

    //------------------ STACK -------------------------------

    buildInstruction("POP_AF", 3, 1, function(cpu) {
        cpu.registers.AF.setValue(cpu.stack.pop());
    });
    buildInstruction("POP_r16", 3, 1, function(cpu, r16) {
        r16.setValue(cpu.stack.pop());
    });
    buildInstruction("PUSH_AF", 4, 1, function(cpu) {
        cpu.stack.push(cpu.registers.AF);
    });
    buildInstruction("PUSH_r16", 4, 1, function(cpu, r16) {
        cpu.stack.push(r16);
    });

    //------------------ RES -------------------------------

    buildInstruction("RES_u3_r8", 2, 2, function(cpu, u3, r8) {
        r8.setValue(byte.setBit(r8.getValue(), u3, 0));
    });
    buildInstruction("RES_u3_HL", 4, 2, function(cpu, u3) {
        const hl = cpu.registers.HL.getValue();
        const a = cpu.memory.read(hl);
        const raw = byte.setBit(a, u3, 0);
        cpu.memory.write(hl, raw);
    });
    
    //------------------ RET -------------------------------

    buildInstruction("RET", 4, 1, function(cpu) {
        cpu.registers.PC.setValue(cpu.stack.pop());
    });
    buildInstruction("RET_cc", [5, 2], 1, function(cpu, cc) {
        if (matchCC(cpu, cc)) {
            cpu.registers.PC.setValue(cpu.stack.pop());
            cpu.cycles += this.extraCycle;
        }
    });
    buildInstruction("RETI", 4, 1, function(cpu) {
        cpu.start();
        cpu.registers.PC.setValue(cpu.stack.pop());
        cpu.cycles += this.extraCycle;
    });

    //------------------ RL -------------------------------

    buildInstruction("RL_r8", 2, 2, function(cpu, r8) {
        const c = cpu.registers.F.C;
        let value = r8.getValue();
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b7;
        value <<= 1;
        value &= 0xff;
        value = byte.setBit(value, 0, c);
        r8.setValue(value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    buildInstruction("RL_HL", 4, 2, function(cpu) {
        const c = cpu.registers.F.C;
        const hl = cpu.registers.HL.getValue();
        let value = cpu.memory.read(hl);
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b7;
        value <<= 1;
        value &= 0xff;
        value = byte.setBit(value, 0, c);
        cpu.memory.write(hl, value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });
    buildInstruction("RLA", 1, 1, function(cpu) {
        const r8 = cpu.registers.A;
        const c = cpu.registers.F.C;
        let value = r8.getValue();
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b7;
        value <<= 1;
        value &= 0xff;
        value = byte.setBit(value, 0, c);
        r8.setValue(value);
        cpu.registers.F.Z = 0;
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    //------------------ RLC -------------------------------

    buildInstruction("RLC_r8", 2, 2, function(cpu, r8) {
        let value = r8.getValue();
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b7;
        value <<= 1;
        value &= 0xff;
        value = byte.setBit(value, 0, b7);
        r8.setValue(value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    buildInstruction("RLC_HL", 4, 2, function(cpu) {
        const hl = cpu.registers.HL.getValue();
        let value = cpu.memory.read(hl);
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b7;
        value <<= 1;
        value &= 0xff;
        value = byte.setBit(value, 0, b7);
        cpu.memory.write(hl, value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });
    buildInstruction("RLCA", 1, 1, function(cpu) {
        const r8 = cpu.registers.A;
        let value = r8.getValue();
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b7;
        value <<= 1;
        value &= 0xff;
        value = byte.setBit(value, 0, b7);
        r8.setValue(value);
        cpu.registers.F.Z = 0;
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    //------------------ RR -------------------------------

    buildInstruction("RR_r8", 2, 2, function(cpu, r8) {
        const c = cpu.registers.F.C;
        let value = r8.getValue();
        const b0 = byte.getBit(value, 0);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, c);
        r8.setValue(value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    buildInstruction("RR_HL", 4, 2, function(cpu) {
        const c = cpu.registers.F.C;
        const hl = cpu.registers.HL.getValue();
        let value = cpu.memory.read(hl);
        const b0 = byte.getBit(value, 0);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, c);
        cpu.memory.write(hl, value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });
    buildInstruction("RRA", 1, 1, function(cpu) {
        const r8 = cpu.registers.A;
        const c = cpu.registers.F.C;
        let value = r8.getValue();
        const b0 = byte.getBit(value, 0);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, c);
        r8.setValue(value);
        cpu.registers.F.Z = 0;
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });
    //------------------ RRC -------------------------------

    buildInstruction("RRC_r8", 2, 2, function(cpu, r8) {
        let value = r8.getValue();
        const b0 = byte.getBit(value, 0);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, b0);
        r8.setValue(value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    buildInstruction("RRC_HL", 4, 2, function(cpu) {
        const hl = cpu.registers.HL.getValue();
        let value = cpu.memory.read(hl);
        const b0 = byte.getBit(value, 0);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, b0);
        cpu.memory.write(hl, value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });
    buildInstruction("RRCA", 1, 1, function(cpu) {
        const r8 = cpu.registers.A;
        let value = r8.getValue();
        const b0 = byte.getBit(value, 0);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, b0);
        r8.setValue(value);
        cpu.registers.F.Z = 0;
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    //------------------ RST -------------------------------

    buildInstruction("RST_vec", 4, 1, function(cpu, vec) {
        cpu.stack.push(cpu.registers.PC.getValue());
        cpu.registers.PC.setValue(vec);
    });

    //------------------ SET -------------------------------

    buildInstruction("SCF", 1, 1, function(cpu) {
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
        cpu.registers.F.C = 1;
    });
    buildInstruction("SET_u3_r8", 2, 2, function(cpu, u3, r8) {
        r8.setValue(byte.setBit(r8.getValue(), u3, 1));
    });
    buildInstruction("SET_u3_HL", 4, 2, function(cpu, u3) {
        const hl = cpu.registers.HL.getValue();
        const a = cpu.memory.read(hl);
        const raw = byte.setBit(a, u3, 1);
        cpu.memory.write(hl, raw);
    });

    //------------------ SHIFT -------------------------------

    buildInstruction("SLA_r8", 2, 2, function(cpu, r8) {
        const c = cpu.registers.F.C;
        let value = r8.getValue();
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b7;
        value <<= 1;
        value &= 0xff;
        value = byte.setBit(value, 0, 0);
        r8.setValue(value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    buildInstruction("SLA_HL", 4, 2, function(cpu) {
        const c = cpu.registers.F.C;
        const hl = cpu.registers.HL.getValue();
        let value = cpu.memory.read(hl);
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b7;
        value <<= 1;
        value &= 0xff;
        value = byte.setBit(value, 0, 0);
        cpu.memory.write(hl, value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });
    buildInstruction("SRA_r8", 2, 2, function(cpu, r8) {
        const c = cpu.registers.F.C;
        let value = r8.getValue();
        const b0 = byte.getBit(value, 0);
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, b7);
        r8.setValue(value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });
    buildInstruction("SRA_HL", 4, 2, function(cpu) {
        const c = cpu.registers.F.C;
        const hl = cpu.registers.HL.getValue();
        let value = cpu.memory.read(hl);
        const b0 = byte.getBit(value, 0);
        const b7 = byte.getBit(value, 7);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, b7);
        cpu.memory.write(hl, value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });
    buildInstruction("SRL_r8", 2, 2, function(cpu, r8) {
        let value = r8.getValue();
        const b0 = byte.getBit(value, 0);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, 0);
        r8.setValue(value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    buildInstruction("SRL_HL", 4, 2, function(cpu) {
        const hl = cpu.registers.HL.getValue();
        let value = cpu.memory.read(hl);
        const b0 = byte.getBit(value, 0);
        cpu.registers.F.C = b0;
        value >>= 1;
        value &= 0xff;
        value = byte.setBit(value, 7, 0);
        cpu.memory.write(hl, value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
    });

    //------------------ SWAP -------------------------------

    buildInstruction("SWAP_r8", 2, 2, function(cpu, r8) {
        let value = r8.getValue();
        const high = (value & 0xf0) >> 4; 
        const low = (value & 0x0f) << 4;
        value = low | high;
        r8.setValue(value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
        cpu.registers.F.C = 0;
    });
    buildInstruction("SWAP_HL", 4, 2, function(cpu) {
        const hl = cpu.registers.HL.getValue();
        let value = cpu.memory.read(hl);
        const high = (value & 0xf0) >> 4; 
        const low = (value & 0x0f) << 4;
        value = low | high;
        cpu.memory.write(hl, value);
        cpu.updateZeroFlag(value);
        cpu.registers.F.N = 0;
        cpu.registers.F.H = 0;
        cpu.registers.F.C = 0;
    });

    return instructions;
}