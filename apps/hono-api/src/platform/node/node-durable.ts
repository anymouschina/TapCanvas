type DurableObjectIdLike = { toString: () => string };

type DurableObjectStorageLike = {
	get: <T = unknown>(key: string) => Promise<T | undefined>;
	put: <T = unknown>(key: string, value: T) => Promise<void>;
};

class NodeDurableObjectStorage implements DurableObjectStorageLike {
	private readonly store = new Map<string, unknown>();

	async get<T = unknown>(key: string): Promise<T | undefined> {
		return this.store.get(key) as T | undefined;
	}

	async put<T = unknown>(key: string, value: T): Promise<void> {
		this.store.set(key, value);
	}
}

class NodeDurableObjectState {
	public readonly id: DurableObjectIdLike;
	public readonly storage: DurableObjectStorageLike;

	constructor(id: string) {
		this.id = { toString: () => id };
		this.storage = new NodeDurableObjectStorage();
	}
}

type DurableObjectInstance = { fetch: (req: Request) => Promise<Response> | Response };

type DurableObjectFactory = (input: { id: string; state: any }) => DurableObjectInstance;

class NodeDurableObjectStub {
	private readonly instance: DurableObjectInstance;

	constructor(instance: DurableObjectInstance) {
		this.instance = instance;
	}

	async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const req = input instanceof Request ? input : new Request(String(input), init);
		return await this.instance.fetch(req);
	}
}

export class NodeDurableObjectNamespace {
	private readonly instances = new Map<string, DurableObjectInstance>();
	private readonly factory: DurableObjectFactory;

	constructor(factory: DurableObjectFactory) {
		this.factory = factory;
	}

	idFromName(name: string): DurableObjectIdLike {
		const id = String(name || "").trim();
		return { toString: () => id };
	}

	get(id: DurableObjectIdLike): any {
		const key = id?.toString ? id.toString() : String(id || "");
		const existing = this.instances.get(key);
		if (existing) return new NodeDurableObjectStub(existing);

		const state = new NodeDurableObjectState(key);
		const instance = this.factory({ id: key, state });
		this.instances.set(key, instance);
		return new NodeDurableObjectStub(instance);
	}
}

