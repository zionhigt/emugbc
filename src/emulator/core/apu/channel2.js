import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import { Channel } from "./channel";

export default function(apu) {
    function ChanFactory(start, Parent) {
        class Chan extends Parent { }
    
        return new Chan(apu, start);
    }
    return Channel(0xFF15, ChanFactory);
}