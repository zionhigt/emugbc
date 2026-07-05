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

function AND(cpu, a, b) {
    const raw = a & b;
    cpu.registers.A.setValue(raw);
    const value = cpu.registers.A.getValue();
    cpu.updateZeroFlag(value);
    cpu.registers.F.N = 0;
    cpu.registers.F.H = 1;
    cpu.registers.F.C = 0;
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



export default function() {
    //------------------ ALU -------------------------------
    buildInstruction("ADC_A_r8", 1, 1, function(cpu, reg8) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        return ADC(cpu, a, r8, c, 8);
    });
    buildInstruction("ADD_A_r8", 1, 1, function(cpu, reg8) {
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        return ADC(cpu, a, r8, 0, 8);
    });

    buildInstruction("ADC_A_HL", 2, 1, function(cpu) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        return ADC(cpu, a, r8, c, 8);
    });
    buildInstruction("ADD_A_HL", 2, 1, function(cpu) {
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        return ADC(cpu, a, r8, 0, 8);
    });

    buildInstruction("ADC_A_n8", 2, 2, function(cpu, n8) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        return ADC(cpu, a, n8, c, 8);
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
        }
    });
    //------------------ CARRY -------------------------------

    buildInstruction("CCF", 1, 1, function(cpu, n16) {
        cpu.registers.F.C = +!cpu.registers.F.C
        cpu.registers.F.H = 0;
        cpu.registers.F.N = 0;
    });
    return instructions;
}