import byte from "./byte.js";

class BaseRegister {
    constructor(ctor) {
        this._buffer = new ctor(1);
    }

    getValue() {
        return this._buffer[0];
    }
    setValue(value) {
        this._buffer[0] = value;
    }
}

class Register8 extends BaseRegister {
    constructor() {
        super(Uint8Array);
    }
}
class Register16 extends BaseRegister {
    constructor() {
        super(Uint16Array);
    }
}

export function FlagRegister(size) {
    const parent = Register(size);
    class FlagRegister extends parent {
        constructor(properties) {
            for (const key of Object.keys(properties)) {
                const priv = `_${key}`;
                this[priv] = properties[key];
                Object.defineProperty(this, key, {
                    get() { 
                        const offset = properties[key].offset;
                        return byte.getBit(this.getValue(), offset);
                     },
                    set(v) {
                        const offset = properties[key].offset;
                        this.setValue(
                            byte.setBit(this.getValue(), offset, v)
                        );
                    },
                    enumerable: true,
                });
            }
        }
    }
}

export function Register(size) {
    switch(size) {
        case 8:
            return Register8;
        case 16:
            return Register16;
        default:
            throw new Error("Unsuported register size it should be 8 or 16.");
    }
}