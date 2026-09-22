/** Coalesce edits, serialize recovery writes and retry when a gesture postpones capture. */
export class RecoveryAutosave {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private requested = 0;
    private saved = 0;
    private active: Promise<void> | undefined;
    private write: (force: boolean) => Promise<boolean>;
    private onSaved: () => void;
    private onError: (error: unknown) => void;
    private delay: number;
    constructor(write: (force: boolean) => Promise<boolean>, onSaved: () => void,
        onError: (error: unknown) => void, delay = 500) {
        this.write=write;this.onSaved=onSaved;this.onError=onError;this.delay=delay;
    }
    request() { this.requested++; this.schedule(); }
    private schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = undefined; void this.run(false).catch(() => {}); }, this.delay);
    }
    private async run(force: boolean): Promise<void> {
        if (this.active) { await this.active; if(force) return this.run(true); return; }
        if (this.saved === this.requested && !force) return;
        const version = this.requested;
        let retry = false;
        this.active = (async () => {
            try {
                if (!await this.write(force)) { if(force) throw Error('请先完成当前编辑或导出'); retry = true; return; }
                this.saved = version;
                if (version === this.requested) this.onSaved();
            } catch(error) { if(version === this.requested) this.onError(error); throw error; }
        })();
        try { await this.active; }
        finally {
            this.active = undefined;
            if (retry || version !== this.requested) this.schedule();
        }
    }
    /** Explicit recovery before an update waits for older writes, then captures the latest state. */
    async flush() { clearTimeout(this.timer); this.timer = undefined; await this.run(true); }
}
