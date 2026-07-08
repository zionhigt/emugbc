/**
 * 
 * @param {*} byte x8 bits 
 * @param {*} position 0 = plus à droite et 7 plus à gauche
 */
export function getBit(byte, position) {
    const mask = 1 << position;
    return (byte & mask) >> position;
}

export function getFlag(byte, position) {
    return !!getBit(byte, position)
}

export function revertBits(byte) {
    for (let i = 0; i < 8; i++) {
        byte = setBit(byte, i, +!getFlag(byte, i));
    }
    return byte;
}
export function setBit(byte, position, value) {
    value = +(!!value)
    if (value) {
        return byte | (value << position);
    } else {
        return byte & (0xff - (2 ** position));
    }
}

export function buildU16(high, low) {
    high <<= 8;
    return high | low;
}
/**
 * 
 * @param {*} byte 
 * return two 8bits byte
 */
export function U16to2U8(byte) {
    const high = (byte >> 8);
    const low = byte % 0x100;
    return { high, low };
}

export function sign8(byte) {
    if (getBit(byte, 7)) return byte - 0x100;
    return byte;
}

export default {
    getBit,
    getFlag,
    setBit,
    buildU16,
    U16to2U8,
    sign8,
    revertBits,
};
