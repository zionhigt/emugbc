import byte from "../../lib/byte";

const instructions = {

}

function buildInstruction(id, run) {
    instructions[id] = {
        id,
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



export default function() {
    buildInstruction("ADC_A_r8", function(cpu, reg8) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        return ADC(cpu, a, r8, c, 8);
    });
    buildInstruction("ADD_A_r8", function(cpu, reg8) {
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        return ADC(cpu, a, r8, 0, 8);
    });

    buildInstruction("ADC_A_HL", function(cpu) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        return ADC(cpu, a, r8, c, 8);
    });
    buildInstruction("ADD_A_HL", function(cpu) {
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        return ADC(cpu, a, r8, 0, 8);
    });

    buildInstruction("ADC_A_n8", function(cpu, n8) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        return ADC(cpu, a, n8, c, 8);
    });
    buildInstruction("ADD_A_n8", function(cpu, n8) {
        const a = cpu.registers.A.getValue();
        return ADC(cpu, a, n8, 0, 8);
    });
    
    buildInstruction("ADD_HL_r16", function(cpu, r16) {
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
    buildInstruction("ADD_HL_SP", function(cpu) {
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
    buildInstruction("ADD_SP_e8", function(cpu, e8) {
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

    return instructions;
}