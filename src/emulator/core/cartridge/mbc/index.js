import NoMBC from "./NoMBC.js"
import MBC1 from "./MBC1.js"

export default function(type, rom) {
    const classMapping = {
        0: NoMBC,
        1: MBC1,
    }
    const cls = classMapping[type];
    if (!cls) throw new Error("Not implemented");
    return new cls(rom);
}