import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ToastHost } from "./toast";

// 回归守卫：套餐页等全屏 Modal 最高使用 zIndex:11010，toast 必须更高，
// 否则 toast 会渲染在 Modal 背后看不见，用户感觉「点击没反应」。
const MODAL_MAX_Z = 11_010;

describe("ToastHost stacking", () => {
	it("renders above full-screen modals", () => {
		const { container } = render(<ToastHost />);
		const host = container.querySelector(".tc-toast-host") as HTMLElement;
		expect(host).toBeTruthy();
		const z = Number(host.style.zIndex);
		expect(Number.isFinite(z)).toBe(true);
		expect(z).toBeGreaterThan(MODAL_MAX_Z);
	});
});
