export type BlockingBackgroundResult = Readonly<{
    ok: true;
    url?: string;
}> | Readonly<{
    ok: false;
    errorMessage: string;
}>;
/** Optional background: omission and blank strings mean no supplied image. */
export declare function parseBlockingBackground(value: unknown): BlockingBackgroundResult;
