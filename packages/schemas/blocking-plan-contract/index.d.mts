export function projectBlockingPlans(root: Record<string, unknown>): {ok:true;blockingPlans:Record<string,unknown>[]} | {ok:false;errorMessage:string};

export function inspectBlockingCharacterCoverage(expected: readonly string[], characters: readonly {name: string}[], path: string): string | null;
