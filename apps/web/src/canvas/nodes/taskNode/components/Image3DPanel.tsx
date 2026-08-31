import * as React from "react";
import { Textarea, Button, Group, Stack } from "@mantine/core";

export type Image3DParams = { prompt: string };
type Props = { onRun: (p: Image3DParams) => void; onClose: () => void };

export function Image3DPanel({ onRun, onClose }: Props) {
	const [prompt, setPrompt] = React.useState("");
	return (
		<div className="tc-task-node__image3d-panel" style={{ position: "absolute", inset: 0, padding: 12, background: "rgba(17,18,21,0.92)", color: "#fff", borderRadius: 12, zIndex: 5 }}>
			<Stack gap={10}>
				<Textarea label="3D 生成（基于当前图片）" placeholder="可选：描述期望的 3D 效果" autosize minRows={2} maxRows={4}
					value={prompt} onChange={(e) => setPrompt(e.currentTarget.value)} />
				<Group justify="flex-end" gap={8}>
					<Button variant="subtle" color="gray" size="xs" onClick={onClose}>取消</Button>
					<Button size="xs" onClick={() => onRun({ prompt: prompt.trim() })}>生成 3D</Button>
				</Group>
			</Stack>
		</div>
	);
}
