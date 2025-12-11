// @ts-nocheck

export class AsyncQueue {
    /**
     *
     * @param {{
     *     interval?: number;
     *     immediate?: boolean;
     * }} [options]
     */
    constructor(options?) {
        this.options = options;

        this.queue = [];
        this.status = 0;
    }

    push(runner, ...params) {
        let resolve; let
            reject;
        const defer = new Promise((rs, rj) => {
            resolve = rs;
            reject = rj;
        });
        const item = {
            runner,
            resolve,
            reject,
            params,
        };
        this.queue.push(item);

        const run = (immediate) => {
            const runIt = () => {
                if (!this.queue.length) {
                    this.status = 0;
                    return;
                }

                const { runner: fn, resolve: rs, reject: rj, params } = this.queue.shift();
                Promise.resolve().then(() => fn(...params)).then(rs, rj).finally(run);
            };
            if (immediate) {
                runIt();
            }
            setTimeout(runIt, this.options?.interval || 16);
            this.status = 1;
        };

        if (!this.status) {
            run(this.options?.immediate);
        }

        return defer;
    }

    abort() {
        this.status = 0;
        this.queue = [];
    }
}
