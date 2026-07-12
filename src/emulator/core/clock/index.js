export default function() {
    class Clock {
        constructor(timeDelta) {
            this.interval = null;
            this._observers = [];
            this.active = false;
            this.timeDelta = timeDelta;
        }

        _destroy() {
            if (!this.interval) return;
            clearInterval(this.interval);
            this.interval = null;
        }

        start() {
            this.active = true;
            this._destroy();
            this.interval = setInterval(
                this.tick.bind(this),
                this.timeDelta
            )
        }

        stop() {
            this.active = false;
            this._destroy();
        }

        tick() {
            if (!this.active) return;
            for (let o of this._observers) {
                if (o && typeof o === "function") o({
                    detail: "tick",
                })
            }
        }

        onTick(cb) {
            this._observers.push(cb);
        }
    }

    return Clock;
}