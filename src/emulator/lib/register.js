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
    increment() {
        return this.setValue(
            this.getValue() + 1
        )
    }
    decrement() {
        return this.setValue(
            this.getValue() - 1
        )
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
            super();
            for (const key of Object.keys(properties)) {
                const priv = `_${key}`;
                this[priv] = properties[key];
                const self = this;
                Object.defineProperty(this, key, {
                    get() { 
                        const offset = properties[key].offset;
                        return byte.getBit(self.getValue(), offset);
                     },
                    set(v) {
                        const offset = properties[key].offset;
                        self.setValue(
                            byte.setBit(self.getValue(), offset, v)
                        );
                    },
                    enumerable: true,
                });
            }
        }
    }

    return FlagRegister;
}

export class Extendedregister {
    constructor(highRegister, lowRegister) {
        this.highRegister = highRegister;
        this.lowRegister = lowRegister;
    }

    getValue() {
        return byte.buildU16(
            this.highRegister.getValue(),
            this.lowRegister.getValue()
        )
    }

    setValue(value) {
        const { high, low } = byte.U16to2U8(value);
        this.highRegister.setValue(high);
        this.lowRegister.setValue(low);
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