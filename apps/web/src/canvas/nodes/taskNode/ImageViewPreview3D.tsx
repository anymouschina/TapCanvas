import React from 'react'
import { Text } from '@mantine/core'
import type {
  ImageCameraControlConfig,
  ImageLightingRigConfig,
} from '@tapcanvas/image-view-controls'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

import { fetchProxiedImageBlob } from '../../../api/server'
import {
  CAMERA_DISTANCE_MAX,
  CAMERA_DISTANCE_MIN,
  getCameraPreviewPoint,
  getLightPreviewPoint,
  LIGHT_PREVIEW_DISTANCE,
  mapLightIntensityToSceneIntensity,
  snapPointToDistance,
  toCameraControlFromPoint,
  toLightControlFromPoint,
  type OrbitPoint3D,
} from './imageView3dMath'

const TARGET_POINT = new THREE.Vector3(0, 0.2, 0)
const FLOOR_Y = -1.55

type ActiveLightSlot = 'main' | 'fill'
type ViewEditorMode = 'camera' | 'lighting'

type ImageViewPreview3DProps = {
  mode: ViewEditorMode
  baseImageUrl: string
  cameraControl: ImageCameraControlConfig
  lightingRig: ImageLightingRigConfig
  activeLightSlot: ActiveLightSlot
  isDarkUi: boolean
  inlineDividerColor: string
  onCameraControlChange: React.Dispatch<React.SetStateAction<ImageCameraControlConfig>>
  onLightingRigChange: React.Dispatch<React.SetStateAction<ImageLightingRigConfig>>
  onActiveLightSlotChange: (slot: ActiveLightSlot) => void
}

type PreviewSceneRefs = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  shotCamera: THREE.PerspectiveCamera
  orbitControls: OrbitControls
  transformControls: TransformControls
  subjectPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  subjectBody: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshStandardMaterial>
  floor: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>
  grid: THREE.GridHelper
  mainLight: THREE.DirectionalLight
  mainLightHelper: THREE.DirectionalLightHelper
  mainLightMarker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
  mainGuideLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  fillLight: THREE.DirectionalLight
  fillLightHelper: THREE.DirectionalLightHelper
  fillLightMarker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
  fillGuideLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  texture: THREE.Texture | null
}

function createGuideLine(color: number): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.45,
  })
  return new THREE.Line(geometry, material)
}

function writeGuideLine(
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  from: THREE.Vector3,
  to: THREE.Vector3,
) {
  const positionAttribute = line.geometry.getAttribute('position')
  if (!(positionAttribute instanceof THREE.BufferAttribute)) return
  positionAttribute.setXYZ(0, from.x, from.y, from.z)
  positionAttribute.setXYZ(1, to.x, to.y, to.z)
  positionAttribute.needsUpdate = true
}

function applyOrbitPoint(object: THREE.Object3D, point: OrbitPoint3D) {
  object.position.set(
    TARGET_POINT.x + point.x,
    TARGET_POINT.y + point.y,
    TARGET_POINT.z + point.z,
  )
  object.lookAt(TARGET_POINT)
}

function readRelativePoint(object: THREE.Object3D): OrbitPoint3D {
  return {
    x: object.position.x - TARGET_POINT.x,
    y: object.position.y - TARGET_POINT.y,
    z: object.position.z - TARGET_POINT.z,
  }
}

function updateShotCamera(scene: PreviewSceneRefs, control: ImageCameraControlConfig) {
  const point = getCameraPreviewPoint(control)
  applyOrbitPoint(scene.shotCamera, point)
  scene.orbitControls.target.copy(TARGET_POINT)
  scene.orbitControls.update()
  scene.shotCamera.updateProjectionMatrix()
}

function updateLightObject(
  sceneLight: THREE.DirectionalLight,
  marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>,
  control: ImageLightingRigConfig['main'],
) {
  const point = getLightPreviewPoint(control)
  applyOrbitPoint(sceneLight, point)
  applyOrbitPoint(marker, point)
  sceneLight.target.position.copy(TARGET_POINT)
  sceneLight.target.updateMatrixWorld()
  sceneLight.visible = control.enabled
  sceneLight.color.set(control.colorHex)
  sceneLight.intensity = control.enabled ? mapLightIntensityToSceneIntensity(control.intensity) : 0
  marker.material.color.set(control.colorHex)
  marker.material.emissive.set(control.colorHex)
  marker.material.opacity = control.enabled ? 0.94 : 0.34
  marker.material.transparent = true
}

function updateSceneTheme(scene: PreviewSceneRefs, isDarkUi: boolean) {
  const gridMaterials = Array.isArray(scene.grid.material) ? scene.grid.material : [scene.grid.material]
  gridMaterials.forEach((material: THREE.Material, index: number) => {
    if (material instanceof THREE.LineBasicMaterial) {
      material.color.set(index === 0
        ? (isDarkUi ? '#2B344A' : '#AAB4C7')
        : (isDarkUi ? '#20283A' : '#D6DEEB'))
    }
  })
  scene.floor.material.color.set(isDarkUi ? '#131A24' : '#EFF2F8')
  scene.floor.material.emissive.set(isDarkUi ? '#0A0D14' : '#F6F8FB')
  scene.subjectBody.material.color.set(isDarkUi ? '#18202D' : '#D6DDEA')
  scene.subjectBody.material.emissive.set(isDarkUi ? '#0C111A' : '#FFFFFF')
  scene.subjectPlane.material.emissive.set(isDarkUi ? '#111723' : '#FFFFFF')
}

function updateSelectionHighlight(
  scene: PreviewSceneRefs,
  input: {
    mode: ViewEditorMode
    activeLightSlot: ActiveLightSlot
    lightingRig: ImageLightingRigConfig
  },
) {
  const mainSelected = input.mode === 'lighting' && input.activeLightSlot === 'main'
  scene.mainLightMarker.material.emissiveIntensity = mainSelected ? 1.1 : 0.45
  scene.mainGuideLine.material.opacity = input.lightingRig.main.enabled ? (mainSelected ? 0.86 : 0.42) : 0.16

  const fillSelected = input.mode === 'lighting' && input.activeLightSlot === 'fill'
  scene.fillLightMarker.material.emissiveIntensity = fillSelected ? 1.1 : 0.45
  scene.fillGuideLine.material.opacity = input.lightingRig.fill.enabled ? (fillSelected ? 0.86 : 0.42) : 0.16
}

function updateInteractionMode(
  scene: PreviewSceneRefs,
  input: {
    mode: ViewEditorMode
    activeLightSlot: ActiveLightSlot
    lightingRig: ImageLightingRigConfig
  },
) {
  const editingCamera = input.mode === 'camera'
  const editingLighting = input.mode === 'lighting'

  scene.orbitControls.enabled = editingCamera && !scene.transformControls.dragging
  scene.orbitControls.enableRotate = editingCamera
  scene.orbitControls.enableZoom = editingCamera
  scene.orbitControls.enablePan = false

  scene.transformControls.enabled = editingLighting
  if (editingLighting) {
    scene.transformControls.attach(
      input.activeLightSlot === 'fill' ? scene.fillLightMarker : scene.mainLightMarker,
    )
  } else {
    scene.transformControls.detach()
  }

  scene.mainLightHelper.visible = editingLighting && input.lightingRig.main.enabled
  scene.fillLightHelper.visible = editingLighting && input.lightingRig.fill.enabled
  scene.mainLightMarker.visible = editingLighting && input.lightingRig.main.enabled
  scene.fillLightMarker.visible = editingLighting && input.lightingRig.fill.enabled
  scene.mainGuideLine.visible = editingLighting && input.lightingRig.main.enabled
  scene.fillGuideLine.visible = editingLighting && input.lightingRig.fill.enabled
}

function hasDisposableGeometry(object: THREE.Object3D): object is THREE.Object3D & { geometry: THREE.BufferGeometry } {
  return 'geometry' in object && object.geometry instanceof THREE.BufferGeometry
}

function hasDisposableMaterial(
  object: THREE.Object3D,
): object is THREE.Object3D & { material: THREE.Material | THREE.Material[] } {
  return 'material' in object
    && (object.material instanceof THREE.Material || Array.isArray(object.material))
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose())
    return
  }
  material.dispose()
}

function disposeSceneResources(scene: THREE.Scene) {
  scene.traverse((object: THREE.Object3D) => {
    if (hasDisposableGeometry(object)) {
      object.geometry.dispose()
    }
    if (hasDisposableMaterial(object)) {
      disposeMaterial(object.material)
    }
  })
}

function createScene(
  host: HTMLDivElement,
  isDarkUi: boolean,
): PreviewSceneRefs {
  const scene = new THREE.Scene()

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearAlpha(0)
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.touchAction = 'none'
  host.appendChild(renderer.domElement)

  const shotCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 12)

  const orbitControls = new OrbitControls(shotCamera, renderer.domElement)
  orbitControls.enableDamping = true
  orbitControls.dampingFactor = 0.08
  orbitControls.target.copy(TARGET_POINT)
  orbitControls.enablePan = false
  orbitControls.minDistance = CAMERA_DISTANCE_MIN
  orbitControls.maxDistance = CAMERA_DISTANCE_MAX
  orbitControls.minPolarAngle = Math.PI * 0.25
  orbitControls.maxPolarAngle = Math.PI * 0.48

  const transformControls = new TransformControls(shotCamera, renderer.domElement)
  transformControls.setMode('translate')
  transformControls.space = 'world'
  transformControls.size = 0.7
  scene.add(transformControls.getHelper())

  const hemisphereLight = new THREE.HemisphereLight(
    isDarkUi ? '#97A2B4' : '#C8D7F0',
    isDarkUi ? '#090C12' : '#C9D0DC',
    1.2,
  )
  scene.add(hemisphereLight)

  const ambientLight = new THREE.AmbientLight(isDarkUi ? '#101726' : '#FDFEFF', 0.6)
  scene.add(ambientLight)

  const grid = new THREE.GridHelper(10, 10, isDarkUi ? '#2B344A' : '#AAB4C7', isDarkUi ? '#20283A' : '#D6DEEB')
  grid.position.y = FLOOR_Y
  scene.add(grid)

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.MeshStandardMaterial({
      color: isDarkUi ? '#131A24' : '#EFF2F8',
      roughness: 0.98,
      metalness: 0.02,
    }),
  )
  floor.receiveShadow = true
  floor.rotation.x = -Math.PI / 2
  floor.position.y = FLOOR_Y + 0.01
  scene.add(floor)

  const subjectBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.62, 1.25, 10, 18),
    new THREE.MeshStandardMaterial({
      color: isDarkUi ? '#18202D' : '#D6DDEA',
      roughness: 0.84,
      metalness: 0.04,
    }),
  )
  subjectBody.castShadow = true
  subjectBody.receiveShadow = true
  subjectBody.position.copy(TARGET_POINT)
  subjectBody.position.y -= 0.1
  scene.add(subjectBody)

  const subjectPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.72, 2.32),
    new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      roughness: 0.76,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  )
  subjectPlane.castShadow = true
  subjectPlane.receiveShadow = true
  subjectPlane.position.set(TARGET_POINT.x, TARGET_POINT.y + 0.12, TARGET_POINT.z + 0.52)
  scene.add(subjectPlane)

  scene.add(shotCamera)

  const mainLight = new THREE.DirectionalLight('#FFFFFF', 1.5)
  const mainLightMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 20, 20),
    new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      emissive: '#FFFFFF',
      emissiveIntensity: 0.78,
      roughness: 0.2,
      metalness: 0.08,
      transparent: true,
      opacity: 0.94,
    }),
  )
  mainLight.castShadow = true
  mainLight.shadow.mapSize.width = 1024
  mainLight.shadow.mapSize.height = 1024
  mainLight.shadow.camera.near = 0.2
  mainLight.shadow.camera.far = 16
  mainLight.shadow.bias = -0.00025
  scene.add(mainLight)
  scene.add(mainLight.target)
  scene.add(mainLightMarker)
  const mainLightHelper = new THREE.DirectionalLightHelper(mainLight, 0.55, '#FFFFFF')
  scene.add(mainLightHelper)
  const mainGuideLine = createGuideLine(0xffffff)
  scene.add(mainGuideLine)

  const fillLight = new THREE.DirectionalLight('#FFFFFF', 0.8)
  const fillLightMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 20, 20),
    new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      emissive: '#FFFFFF',
      emissiveIntensity: 0.52,
      roughness: 0.24,
      metalness: 0.04,
      transparent: true,
      opacity: 0.82,
    }),
  )
  scene.add(fillLight)
  scene.add(fillLight.target)
  scene.add(fillLightMarker)
  const fillLightHelper = new THREE.DirectionalLightHelper(fillLight, 0.48, '#FFFFFF')
  scene.add(fillLightHelper)
  const fillGuideLine = createGuideLine(0xc7d2fe)
  scene.add(fillGuideLine)

  transformControls.addEventListener('dragging-changed', (event: { value?: unknown }) => {
    const dragging = typeof event.value === 'boolean' ? event.value : false
    orbitControls.enabled = !dragging && !transformControls.object
  })

  return {
    renderer,
    scene,
    shotCamera,
    orbitControls,
    transformControls,
    subjectPlane,
    subjectBody,
    floor,
    grid,
    mainLight,
    mainLightHelper,
    mainLightMarker,
    mainGuideLine,
    fillLight,
    fillLightHelper,
    fillLightMarker,
    fillGuideLine,
    texture: null,
  }
}
export function ImageViewPreview3D(props: ImageViewPreview3DProps): JSX.Element {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const sceneRef = React.useRef<PreviewSceneRefs | null>(null)
  const modeRef = React.useRef<ViewEditorMode>(props.mode)
  const cameraControlRef = React.useRef(props.cameraControl)
  const onCameraControlChangeRef = React.useRef(props.onCameraControlChange)
  const onLightingRigChangeRef = React.useRef(props.onLightingRigChange)
  const onActiveLightSlotChangeRef = React.useRef(props.onActiveLightSlotChange)
  const syncingOrbitRef = React.useRef(false)
  const [sceneError, setSceneError] = React.useState<string | null>(null)

  modeRef.current = props.mode
  cameraControlRef.current = props.cameraControl
  onCameraControlChangeRef.current = props.onCameraControlChange
  onLightingRigChangeRef.current = props.onLightingRigChange
  onActiveLightSlotChangeRef.current = props.onActiveLightSlotChange

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let animationFrameId = 0
    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    let removeTransformListener: (() => void) | null = null
    let removeOrbitListener: (() => void) | null = null

    try {
      const scene = createScene(host, props.isDarkUi)
      sceneRef.current = scene

      const updateRendererSize = () => {
        if (!host.clientWidth || !host.clientHeight) return
        scene.renderer.setSize(host.clientWidth, host.clientHeight, false)
        scene.shotCamera.aspect = host.clientWidth / host.clientHeight
        scene.shotCamera.updateProjectionMatrix()
      }

      resizeObserver = new ResizeObserver(() => updateRendererSize())
      resizeObserver.observe(host)
      updateRendererSize()

      const renderFrame = () => {
        if (disposed) return
        animationFrameId = window.requestAnimationFrame(renderFrame)

        scene.orbitControls.update()
        scene.mainLightHelper.update()
        scene.fillLightHelper.update()
        writeGuideLine(scene.mainGuideLine, scene.mainLight.position, TARGET_POINT)
        writeGuideLine(scene.fillGuideLine, scene.fillLight.position, TARGET_POINT)
        scene.renderer.render(scene.scene, scene.shotCamera)
      }

      const syncFromTransform = () => {
        const currentScene = sceneRef.current
        if (!currentScene) return
        const selectedObject = currentScene.transformControls.object
        if (!selectedObject) return

        const nextPoint = snapPointToDistance(readRelativePoint(selectedObject), LIGHT_PREVIEW_DISTANCE)
        applyOrbitPoint(selectedObject, nextPoint)
        const slot = selectedObject === currentScene.fillLightMarker ? 'fill' : 'main'
        onActiveLightSlotChangeRef.current(slot)
        onLightingRigChangeRef.current((current) => ({
          ...current,
          [slot]: toLightControlFromPoint(current[slot], nextPoint),
        }))
      }

      const syncWhileDragging = () => {
        if (!scene.transformControls.dragging) return
        syncFromTransform()
      }

      scene.transformControls.addEventListener('change', syncWhileDragging)
      scene.transformControls.addEventListener('mouseUp', syncFromTransform)
      removeTransformListener = () => {
        scene.transformControls.removeEventListener('change', syncWhileDragging)
        scene.transformControls.removeEventListener('mouseUp', syncFromTransform)
      }

      const syncFromOrbit = () => {
        if (syncingOrbitRef.current || modeRef.current !== 'camera') return
        const currentScene = sceneRef.current
        if (!currentScene) return

        const nextControl = toCameraControlFromPoint(
          cameraControlRef.current,
          readRelativePoint(currentScene.shotCamera),
        )
        onCameraControlChangeRef.current((current) => {
          const sameAzimuth = Math.abs(current.azimuthDeg - nextControl.azimuthDeg) < 0.01
          const sameElevation = Math.abs(current.elevationDeg - nextControl.elevationDeg) < 0.01
          const sameDistance = Math.abs(current.distance - nextControl.distance) < 0.01
          if (
            current.enabled === nextControl.enabled
            && current.presetId === nextControl.presetId
            && sameAzimuth
            && sameElevation
            && sameDistance
          ) {
            return current
          }
          return nextControl
        })
      }

      scene.orbitControls.addEventListener('change', syncFromOrbit)
      removeOrbitListener = () => {
        scene.orbitControls.removeEventListener('change', syncFromOrbit)
      }
      renderFrame()
    } catch (error) {
      const message = error instanceof Error ? error.message : '3D 预览初始化失败'
      setSceneError(message)
    }

    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrameId)
      resizeObserver?.disconnect()
      removeTransformListener?.()
      removeOrbitListener?.()

      const scene = sceneRef.current
      if (!scene) return

      scene.orbitControls.dispose()
      scene.transformControls.dispose()
      scene.renderer.dispose()
      scene.texture?.dispose()
      disposeSceneResources(scene.scene)
      host.replaceChildren()
      sceneRef.current = null
    }
  }, [])

  React.useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    updateSceneTheme(scene, props.isDarkUi)
  }, [props.isDarkUi])

  React.useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    syncingOrbitRef.current = true
    updateShotCamera(scene, props.cameraControl)
    syncingOrbitRef.current = false
    updateSelectionHighlight(scene, {
      mode: props.mode,
      activeLightSlot: props.activeLightSlot,
      lightingRig: props.lightingRig,
    })
  }, [props.activeLightSlot, props.cameraControl, props.lightingRig, props.mode])

  React.useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    updateLightObject(scene.mainLight, scene.mainLightMarker, props.lightingRig.main)
    updateLightObject(scene.fillLight, scene.fillLightMarker, props.lightingRig.fill)
    scene.mainLightHelper.update()
    scene.fillLightHelper.update()
    updateSelectionHighlight(scene, {
      mode: props.mode,
      activeLightSlot: props.activeLightSlot,
      lightingRig: props.lightingRig,
    })
  }, [props.activeLightSlot, props.cameraControl.enabled, props.lightingRig, props.mode])

  React.useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    updateInteractionMode(scene, {
      mode: props.mode,
      activeLightSlot: props.activeLightSlot,
      lightingRig: props.lightingRig,
    })
  }, [props.activeLightSlot, props.cameraControl.enabled, props.lightingRig, props.mode])

  React.useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    let cancelled = false
    let objectUrl: string | null = null

    void (async () => {
      try {
        const blob = await fetchProxiedImageBlob(props.baseImageUrl)
        if (cancelled || !sceneRef.current) return

        objectUrl = URL.createObjectURL(blob)

        const loader = new THREE.TextureLoader()
        loader.load(
          objectUrl,
          (texture: THREE.Texture) => {
            if (cancelled || !sceneRef.current) {
              texture.dispose()
              return
            }
            texture.colorSpace = THREE.SRGBColorSpace
            texture.anisotropy = scene.renderer.capabilities.getMaxAnisotropy()

            const image = texture.image
            const width = typeof image?.width === 'number' ? image.width : 1
            const height = typeof image?.height === 'number' ? image.height : 1
            const imageAspect = Math.min(1.42, Math.max(0.62, width / Math.max(height, 1)))

            scene.subjectPlane.scale.set(imageAspect, 1, 1)
            scene.subjectPlane.material.map = texture
            scene.subjectPlane.material.needsUpdate = true
            scene.texture?.dispose()
            scene.texture = texture
          },
          undefined,
          (error: unknown) => {
            console.warn('image view texture load failed', error)
          },
        )
      } catch (error) {
        console.warn('image view proxy fetch failed', error)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [props.baseImageUrl])

  return (
    <div
      className="tc-image-view-editor__preview-stage"
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        border: `1px solid ${props.inlineDividerColor}`,
        overflow: 'hidden',
        background: props.isDarkUi
          ? 'radial-gradient(circle at 50% 22%, rgba(148,163,184,0.16), rgba(15,23,42,0.76) 58%, rgba(2,6,23,0.98) 100%)'
          : 'radial-gradient(circle at 50% 18%, rgba(226,232,240,0.96), rgba(244,247,251,0.94) 58%, rgba(226,232,240,0.88) 100%)',
      }}
      >
        <div
          ref={hostRef}
          className="tc-image-view-editor__preview-webgl"
          style={{ position: 'absolute', inset: 0 }}
        />
      {sceneError ? (
        <div
          className="tc-image-view-editor__preview-error-shell"
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 12,
            pointerEvents: 'none',
          }}
        >
          <Text
            className="tc-image-view-editor__preview-error"
            size="xs"
            c="red.4"
            style={{
              display: 'inline-flex',
              padding: '5px 8px',
              border: `1px solid ${props.isDarkUi ? 'rgba(248,113,113,0.24)' : 'rgba(220,38,38,0.18)'}`,
              background: props.isDarkUi ? 'rgba(20,10,12,0.86)' : 'rgba(255,245,245,0.9)',
            }}
          >
            3D 预览初始化失败：{sceneError}
          </Text>
        </div>
      ) : null}
    </div>
  )
}
