import NoMBC from "./NoMBC.js"
import MBC1 from "./MBC1.js"

export default function(type, rom) {
    const classMapping = {
        0: NoMBC,
        1: MBC1,
    }
    let cls = classMapping[type];
    if (!cls) {
        console.warn(`MBC ${type} Not implemented`);
        cls = MBC1;
    }
    return new cls(rom);
}