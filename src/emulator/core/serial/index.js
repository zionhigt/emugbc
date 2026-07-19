export default function(logger) {
    class SerialBus {
        constructor() {}

        read () {};
        write () {};

        echo(value) {
            logger.log(value.map(i => String.fromCharCode(i)).join(""));
        }
    }

    return SerialBus;
}