import React from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { CameraObj, DirectorScene, Vec3 } from '../types'

type Props = {
  camera: CameraObj; scene: DirectorScene; active: boolean; selected: boolean; onSelect: () => void
  /** 播放时给定的实时采样机位（沿运镜路径滑行）；缺省用 camera 的静态位姿。 */
  override?: { position: Vec3; lookAt: Vec3; fovDeg: number } | null
}

function resolveLookAt(cam: CameraObj, scene: DirectorScene): Vec3 {
  if (cam.lookAtMode !== 'manual') {
    const target = scene.characters.find((c) => c.id === cam.lookAtMode)
    if (target) return [target.position[0], target.position[1] + 1.2, target.position[2]]
  }
  return cam.lookAt
}

/** 用一台离屏透视相机生成视锥 helper，仅在导演视角可见 */
export function CameraRig({ camera, scene, active, selected, onSelect, override }: Props) {
  const { scene: rootScene } = useThree()
  const helperRef = React.useRef<THREE.CameraHelper | null>(null)
  const camRef = React.useRef<THREE.PerspectiveCamera | null>(null)
  const groupRef = React.useRef<THREE.Group | null>(null)

  React.useEffect(() => {
    if (!active) return
    const cam = new THREE.PerspectiveCamera(camera.fovDeg, 16 / 9, 0.3, 8)
    camRef.current = cam
    const helper = new THREE.CameraHelper(cam)
    helperRef.current = helper
    rootScene.add(helper)
    return () => {
      rootScene.remove(helper)
      helper.dispose()
      helperRef.current = null
      camRef.current = null
    }
  }, [active, rootScene, camera.fovDeg])

  useFrame(() => {
    const cam = camRef.current
    if (!cam) return
    // 播放时用实时采样位姿（沿运镜路径滑行）；否则用机位静态位姿
    const pos = override?.position ?? camera.position
    const la = override?.lookAt ?? resolveLookAt(camera, scene)
    cam.fov = override?.fovDeg ?? camera.fovDeg
    cam.position.set(pos[0], pos[1], pos[2])
    cam.lookAt(la[0], la[1], la[2])
    if (camera.roll && !override) cam.rotateZ(camera.roll * (Math.PI / 180)) // 荷兰角：视锥 helper 跟着倾（采样位姿已含朝向，不重复施加）
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld(true)
    helperRef.current?.update()
    if (helperRef.current) (helperRef.current.material as THREE.LineBasicMaterial).color.set(override ? '#f59e0b' : selected ? '#52c41a' : '#626872')
    // 相机图标 + 标签实时跟到采样位置
    if (groupRef.current) groupRef.current.position.set(pos[0], pos[1], pos[2])
  })

  if (!active) return null
  return (
    // userData.directorHelper：截图/出片时随其它辅助物一起隐藏，相机图标不进产出画面
    <group ref={groupRef} position={camera.position} userData={{ directorHelper: true }} onClick={(e) => { e.stopPropagation(); onSelect() }}>
      <mesh>
        <boxGeometry args={[0.3, 0.2, 0.4]} />
        <meshStandardMaterial color={selected ? '#52c41a' : '#888'} />
      </mesh>
      <Html position={[0, 0.35, 0]} center distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <div style={{ fontSize: 11, color: selected ? '#52c41a' : '#9ca3af', whiteSpace: 'nowrap', textShadow: '0 1px 2px #000' }}>{camera.name}</div>
      </Html>
    </group>
  )
}
