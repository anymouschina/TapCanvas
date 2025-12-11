// @ts-nocheck

export class Evt {
    #events = [];

    on(event, callback) {
        this.#events.push([event, callback]);
    }

    once(event, callback) {
        this.#events.push([event, callback, true]);
    }

    emit(event, ...args) {
        this.#events.forEach(([eventName, callback, once]) => {
            if (event === eventName || eventName === '*') {
                callback(...args);
                if (once) {
                    this.off(event, callback);
                }
            }
        });
    }

    off(event, callback?) {
        this.#events.forEach(([eventName, eventCall], i) => {
            if (event === eventName && (!callback || eventCall === callback)) {
                this.#events.splice(i, 1);
            }
        });
    }

    clear() {
        this.#events = [];
    }
}
