import * as React from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { unzipSync, strFromU8 } from "fflate";

type Props = { modelUrl: string; visible: boolean };
const DRACO_PATH = "https://www.gstatic.com/draco/v1/decoders/";

export function Model3DOverlay({ modelUrl, visible }: Props) {
	const hostRef = React.useRef<HTMLDivElement | null>(null);
	const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
	const sceneRef = React.useRef<THREE.Scene | null>(null);
	const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
	const controlsRef = React.useRef<OrbitControls | null>(null);
	const modelRef = React.useRef<THREE.Object3D | null>(null);
	const [error, setError] = React.useState<string | null>(null);

	const requestRender = React.useCallback(() => {
		const r = rendererRef.current,
			s = sceneRef.current,
			c = cameraRef.current;
		if (r && s && c) r.render(s, c);
	}, []);

	React.useEffect(() => {
		if (!visible) return;
		const host = hostRef.current;
		if (!host) return;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color("#f6f7f8");
		sceneRef.current = scene;
		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
		camera.position.set(0, 1.1, 2.8);
		cameraRef.current = camera;
		const renderer = new THREE.WebGLRenderer({
			antialias: true,
			powerPreference: "high-performance",
			preserveDrawingBuffer: true,
		});
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1;
		renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
		rendererRef.current = renderer;
		host.appendChild(renderer.domElement);
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = false;
		controls.enablePan = true;
		controls.minDistance = 0.2;
		controls.maxDistance = 500;
		controls.addEventListener("change", requestRender);
		controlsRef.current = controls;
		scene.add(new THREE.AmbientLight(0xffffff, 1.1));
		const key = new THREE.DirectionalLight(0xffffff, 1.3);
		key.position.set(3, 5, 2);
		scene.add(key);
		const fill = new THREE.DirectionalLight(0xffffff, 0.5);
		fill.position.set(-2, 3, -2);
		scene.add(fill);
		scene.add(new THREE.GridHelper(10, 10, 0xe5e7eb, 0xf1f5f9));
		const resize = () => {
			const w = Math.max(1, host.clientWidth),
				h = Math.max(1, host.clientHeight);
			renderer.setSize(w, h, true);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			requestRender();
		};
		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(host);
		return () => {
			ro.disconnect();
			controls.removeEventListener("change", requestRender);
			controls.dispose();
			if (modelRef.current) {
				scene.remove(modelRef.current);
				modelRef.current = null;
			}
			renderer.dispose();
			renderer.domElement.remove();
			rendererRef.current = null;
			cameraRef.current = null;
			sceneRef.current = null;
			controlsRef.current = null;
		};
	}, [visible, requestRender]);

	React.useEffect(() => {
		const scene = sceneRef.current;
		if (!visible || !scene || !modelUrl) return;
		setError(null);
		const loader = new GLTFLoader();
		loader.setCrossOrigin("anonymous");
		const draco = new DRACOLoader();
		draco.setDecoderPath(DRACO_PATH);
		loader.setDRACOLoader(draco);
		const fitToObject = (object: THREE.Object3D) => {
			const camera = cameraRef.current,
				controls = controlsRef.current;
			if (!camera || !controls) return;
			const box = new THREE.Box3().setFromObject(object, true);
			if (box.isEmpty()) return;
			const sphere = box.getBoundingSphere(new THREE.Sphere());
			const radius = Math.max(sphere.radius, Number.EPSILON);
			const vFov = THREE.MathUtils.degToRad(camera.fov);
			const aspect = Math.max(camera.aspect, Number.EPSILON);
			const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
			const minFov = Math.max(Math.min(vFov, hFov), Number.EPSILON);
			const distance = (radius / Math.sin(minFov / 2)) * 1.28;
			const dir = new THREE.Vector3(1, 0.82, 1).normalize();
			camera.position.copy(dir.multiplyScalar(distance));
			camera.near = Math.max(distance / 120, 0.01);
			camera.far = Math.max(distance + radius * 6, 120);
			camera.updateProjectionMatrix();
			controls.target.set(0, 0, 0);
			controls.update();
		};
		const commit = (obj: THREE.Object3D) => {
			if (modelRef.current) scene.remove(modelRef.current);
			modelRef.current = obj;
			scene.add(obj);
			fitToObject(obj);
			requestRender();
		};
		const ext = (modelUrl.split("?")[0].split(".").pop() || "").toLowerCase();
		let cancelled = false;
		if (ext === "zip") {
			void (async () => {
				try {
					const resp = await fetch(modelUrl);
					if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
					const archive = unzipSync(new Uint8Array(await resp.arrayBuffer()));
					if (cancelled) return;
					const main = Object.keys(archive).find((p) =>
						/\.(glb|gltf)$/i.test(p),
					);
					if (!main) {
						setError("ZIP 内未找到可预览的 GLB/GLTF");
						return;
					}
					if (/\.glb$/i.test(main)) {
						loader.parse(
							archive[main].buffer as ArrayBuffer,
							"",
							(g) => !cancelled && commit(g.scene),
							(e) => setError(String((e as any)?.message || e)),
						);
					} else {
						loader.parse(
							strFromU8(archive[main]),
							"",
							(g) => !cancelled && commit(g.scene),
							(e) => setError(String((e as any)?.message || e)),
						);
					}
				} catch (e) {
					if (!cancelled)
						setError(e instanceof Error ? e.message : String(e));
				}
			})();
		} else {
			loader.load(
				modelUrl,
				(g) => !cancelled && commit(g.scene),
				undefined,
				(e) =>
					!cancelled &&
					setError(e instanceof Error ? e.message : "模型加载失败"),
			);
		}
		return () => {
			cancelled = true;
			draco.dispose();
		};
	}, [visible, modelUrl, requestRender]);

	if (!visible) return null;
	return (
		<div
			className="tc-task-node__model3d-overlay"
			style={{
				position: "absolute",
				inset: 0,
				borderRadius: 12,
				overflow: "hidden",
				background: "#f6f7f8",
			}}
		>
			<div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
			{error && (
				<div
					style={{
						position: "absolute",
						left: 8,
						bottom: 8,
						fontSize: 11,
						color: "#ef4444",
					}}
				>
					{error}
				</div>
			)}
		</div>
	);
}
