export default function(logger) {
    class SerialBus {
        constructor() {}

        read () {};
        write () {};

        echo(value) {
            logger.log(value);
        }
    }

    return SerialBus;
}