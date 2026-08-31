import { describe, expect, it, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { Model3DOverlay } from "./Model3DOverlay";

vi.mock("three", async (orig) => {
	const actual = await orig<typeof import("three")>();
	class FakeRenderer {
		domElement = document.createElement("canvas");
		setPixelRatio() {}
		setSize() {}
		render() {}
		dispose() {}
		outputColorSpace = "";
		toneMapping = 0;
		toneMappingExposure = 1;
	}
	return { ...actual, WebGLRenderer: FakeRenderer };
});

// mock GLTFLoader / DRACOLoader / OrbitControls 避免 jsdom 里触发真实 fetch 和 AbortSignal 不兼容
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
	GLTFLoader: class {
		setCrossOrigin() {}
		setDRACOLoader() {}
		load() {}
		parse() {}
	},
}));

vi.mock("three/examples/jsm/loaders/DRACOLoader.js", () => ({
	DRACOLoader: class {
		setDecoderPath() {}
		dispose() {}
	},
}));

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
	OrbitControls: class {
		enableDamping = false;
		enablePan = true;
		minDistance = 0;
		maxDistance = 1000;
		target = { set() {} };
		addEventListener() {}
		removeEventListener() {}
		dispose() {}
		update() {}
	},
}));

beforeAll(() => {
	// jsdom 无 ResizeObserver（vitest.setup.ts 已经 mock，但以防万一）
	if (!(globalThis as any).ResizeObserver) {
		(globalThis as any).ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}
});

describe("Model3DOverlay", () => {
	it("renders nothing when not visible", () => {
		const { container } = render(
			<Model3DOverlay modelUrl="https://x/m.glb" visible={false} />,
		);
		expect(container.firstChild).toBeNull();
	});
	it("mounts and unmounts without throwing when visible", () => {
		const { unmount } = render(
			<Model3DOverlay modelUrl="https://x/m.glb" visible />,
		);
		expect(() => unmount()).not.toThrow();
	});
});
