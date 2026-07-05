const instructions = {

}

function buildInstruction(id, run) {
    instructions[id] = {
        id,
        run() { return run.apply(this, ...[arguments]) }
    }
}

export default function() {
    buildInstruction("ADC_A_r8", function(cpu, reg8) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const r8 = reg8.getValue();
        const raw = a + r8 + c;
        cpu.registers.A.setValue(raw);
        const value = cpu.registers.A.getValue();
        const operation = {
            size: 8,
            id: 0,
            a: a,
            b: r8,
            raw: raw,
        }
        cpu
        .updateZeroFlag(value)
        .updateNAndHFlags(operation, c)
        .updateCarryFlag(operation);
    });

    buildInstruction("ADC_A_HL", function(cpu) {
        const c = +!!(cpu.registers.F.C);
        const a = cpu.registers.A.getValue();
        const hl = cpu.registers.HL.getValue();
        const r8 = cpu.memory.read(hl);
        const raw = a + r8 + c;
        cpu.registers.A.setValue(raw);
        const value = cpu.registers.A.getValue();
        const operation = {
            size: 8,
            id: 0,
            a: a,
            b: r8,
            raw: raw,
        }
        cpu
        .updateZeroFlag(value)
        .updateNAndHFlags(operation, c)
        .updateCarryFlag(operation);
    });

    return instructions;
}