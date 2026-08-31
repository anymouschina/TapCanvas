import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Image3DPanel } from "./Image3DPanel";

const renderP = (props: any) => render(<MantineProvider><Image3DPanel {...props} /></MantineProvider>);

describe("Image3DPanel", () => {
	it("emits empty prompt by default on run", () => {
		const onRun = vi.fn();
		renderP({ onRun, onClose: vi.fn() });
		fireEvent.click(screen.getByText("生成 3D"));
		expect(onRun).toHaveBeenCalledWith({ prompt: "" });
	});
	it("emits typed prompt on run", () => {
		const onRun = vi.fn();
		renderP({ onRun, onClose: vi.fn() });
		fireEvent.change(screen.getByPlaceholderText("可选：描述期望的 3D 效果"), { target: { value: "手办风" } });
		fireEvent.click(screen.getByText("生成 3D"));
		expect(onRun).toHaveBeenCalledWith({ prompt: "手办风" });
	});
});
