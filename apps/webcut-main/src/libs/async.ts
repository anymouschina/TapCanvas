export async function asyncOf<T>(promise: Promise<T>): Promise<[error: Error | null, data: T | null]> {
    try {
        const data = await promise;
        return [null, data];
    }
    catch (e) {
        // @ts-ignore
        return [e, null];
    }
}
