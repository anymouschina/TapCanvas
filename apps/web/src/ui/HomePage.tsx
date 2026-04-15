import React from 'react'
import { Anchor, Text, Title } from '@mantine/core'
import { IconArrowRight } from '@tabler/icons-react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { buildStudioUrl } from '../utils/appRoutes'
import './homePage.css'

const HOME_TITLE_LINES = ['TAP', 'CANVAS'] as const

const HOME_STAGGER_TRANSITION = {
  duration: 0.9,
  ease: [0.22, 1, 0.36, 1],
} as const

export default function HomePage(): JSX.Element {
  const workspaceUrl = buildStudioUrl()
  const sceneRef = React.useRef<HTMLDivElement | null>(null)
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  const breachTiltX = useSpring(useTransform(mouseY, [-0.5, 0.5], [7, -9]), {
    stiffness: 120,
    damping: 18,
    mass: 0.8,
  })
  const breachTiltY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-9, 11]), {
    stiffness: 120,
    damping: 18,
    mass: 0.8,
  })
  const riftShiftX = useSpring(useTransform(mouseX, [-0.5, 0.5], [-20, 24]), {
    stiffness: 110,
    damping: 19,
    mass: 0.85,
  })
  const riftShiftY = useSpring(useTransform(mouseY, [-0.5, 0.5], [-18, 24]), {
    stiffness: 110,
    damping: 19,
    mass: 0.85,
  })
  const fractureOffsetA = useSpring(useTransform(mouseX, [-0.5, 0.5], [-24, 18]), {
    stiffness: 130,
    damping: 21,
    mass: 0.7,
  })
  const fractureOffsetB = useSpring(useTransform(mouseY, [-0.5, 0.5], [-16, 18]), {
    stiffness: 130,
    damping: 21,
    mass: 0.7,
  })
  const glowX = useTransform(mouseX, [-0.5, 0.5], ['44%', '60%'])
  const glowY = useTransform(mouseY, [-0.5, 0.5], ['20%', '72%'])
  const shadowX = useTransform(mouseX, [-0.5, 0.5], [-24, 24])
  const shadowY = useTransform(mouseY, [-0.5, 0.5], [-12, 28])
  const breachShadow = useTransform(
    [shadowX, shadowY],
    ([currentShadowX, currentShadowY]: number[]) =>
      `${currentShadowX}px ${52 + currentShadowY}px 150px rgba(0, 0, 0, 0.62)`,
  )

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const sceneElement = sceneRef.current
      if (!sceneElement) {
        throw new Error('Homepage scene is unavailable during pointer interaction.')
      }

      const bounds = sceneElement.getBoundingClientRect()
      const relativeX = (event.clientX - bounds.left) / bounds.width - 0.5
      const relativeY = (event.clientY - bounds.top) / bounds.height - 0.5

      mouseX.set(relativeX)
      mouseY.set(relativeY)
    },
    [mouseX, mouseY],
  )

  const handlePointerLeave = React.useCallback(() => {
    mouseX.set(0)
    mouseY.set(0)
  }, [mouseX, mouseY])

  return (
    <main className="tc-home-page">
      <div className="tc-home-page__noise-layer" />
      <div className="tc-home-page__scanline-layer" />
      <div className="tc-home-page__rift-glow tc-home-page__rift-glow--left" />
      <div className="tc-home-page__rift-glow tc-home-page__rift-glow--right" />
      <div className="tc-home-page__fault-grid tc-home-page__fault-grid--rear" />
      <div className="tc-home-page__fault-grid tc-home-page__fault-grid--front" />
      <div className="tc-home-page__fault-column tc-home-page__fault-column--left" />
      <div className="tc-home-page__fault-column tc-home-page__fault-column--right" />

      <motion.section
        ref={sceneRef}
        className="tc-home-page__scene"
        aria-label="TapCanvas 创作入口"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <motion.div
          className="tc-home-page__title-field"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: {
              transition: {
                staggerChildren: 0.08,
                delayChildren: 0.04,
              },
            },
          }}
        >
          <motion.div
            className="tc-home-page__eyebrow-wrap"
            variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
            transition={HOME_STAGGER_TRANSITION}
          >
            <Text className="tc-home-page__eyebrow">TapCanvas / 创作入口</Text>
          </motion.div>

          <motion.div
            className="tc-home-page__title-architecture"
            variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } }}
            transition={HOME_STAGGER_TRANSITION}
          >
            <motion.div
              className="tc-home-page__title-echo-cloud"
              aria-hidden="true"
              style={{ x: fractureOffsetA, y: fractureOffsetB }}
              animate={{ opacity: [0.22, 0.4, 0.18], filter: ['blur(1px)', 'blur(0px)', 'blur(2px)'] }}
              transition={{ duration: 4.4, repeat: Infinity, ease: [0.52, 0, 0.18, 1] }}
            >
              {HOME_TITLE_LINES.map((line, index) => (
                <Text className={`tc-home-page__title-echo tc-home-page__title-echo--line-${index + 1}`} key={`echo-${line}`}>
                  {line}
                </Text>
              ))}
            </motion.div>

            <div className="tc-home-page__title-main">
              {HOME_TITLE_LINES.map((line, index) => (
                <div className={`tc-home-page__title-line tc-home-page__title-line--${index + 1}`} key={line}>
                  <div className="tc-home-page__title-clone tc-home-page__title-clone--back" aria-hidden="true">
                    <Title order={1} className={`tc-home-page__title tc-home-page__title--${index + 1}`}>
                      {line}
                    </Title>
                  </div>
                  <div className="tc-home-page__title-clone tc-home-page__title-clone--front">
                    <div className="tc-home-page__title-fragment tc-home-page__title-fragment--upper">
                      <Title order={1} className={`tc-home-page__title tc-home-page__title--${index + 1}`}>
                        {line}
                      </Title>
                    </div>
                    <div className="tc-home-page__title-fragment tc-home-page__title-fragment--lower">
                      <Title order={1} className={`tc-home-page__title tc-home-page__title--${index + 1}`}>
                        {line}
                      </Title>
                    </div>
                  </div>
                </div>
              ))}

              <div className="tc-home-page__title-rift" aria-hidden="true">
                <div className="tc-home-page__title-rift-core" />
                <div className="tc-home-page__title-rift-shadow" />
              </div>
              <div className="tc-home-page__title-scratch tc-home-page__title-scratch--a" aria-hidden="true" />
              <div className="tc-home-page__title-scratch tc-home-page__title-scratch--b" aria-hidden="true" />
              <div className="tc-home-page__title-mask tc-home-page__title-mask--left" aria-hidden="true" />
              <div className="tc-home-page__title-mask tc-home-page__title-mask--right" aria-hidden="true" />
            </div>
          </motion.div>

          <motion.div
            className="tc-home-page__copy-drift"
            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
            transition={HOME_STAGGER_TRANSITION}
          >
            <Text className="tc-home-page__lede">
              从整本原文出发，直接进入项目、章节、镜头和共享资产的同一生产现场。
            </Text>
            <Text className="tc-home-page__sublede">
              TapCanvas 把文本导入、章节推进、镜头生成、资产复用和后续视频生产放进一条连续链路，不再让你在多个工具之间来回切换。
            </Text>
          </motion.div>
        </motion.div>

        <motion.div
          className="tc-home-page__breach-stage"
          initial={{ opacity: 0, scale: 0.96, y: 28 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
          style={{
            rotateX: breachTiltX,
            rotateY: breachTiltY,
            boxShadow: breachShadow,
          }}
        >
          <motion.div className="tc-home-page__breach-light" aria-hidden="true" style={{ left: glowX, top: glowY }} />
          <motion.div
            className="tc-home-page__breach-spine"
            aria-hidden="true"
            style={{ x: riftShiftX, y: riftShiftY }}
            animate={{ scaleY: [0.94, 1.08, 0.97], opacity: [0.7, 1, 0.82] }}
            transition={{ duration: 5.4, repeat: Infinity, ease: [0.42, 0, 0.22, 1] }}
          />
          <motion.div
            className="tc-home-page__breach-wall tc-home-page__breach-wall--rear"
            aria-hidden="true"
            animate={{ x: [-18, 16, -10], y: [8, -10, 6], rotate: [-8, -13, -9] }}
            transition={{ duration: 6.8, repeat: Infinity, ease: [0.56, 0, 0.2, 1] }}
          />
          <motion.div
            className="tc-home-page__breach-wall tc-home-page__breach-wall--mid"
            aria-hidden="true"
            animate={{ x: [14, -20, 10], y: [-6, 16, -4], rotate: [7, 12, 8] }}
            transition={{ duration: 6.2, repeat: Infinity, ease: [0.56, 0, 0.2, 1] }}
          />
          <motion.div
            className="tc-home-page__breach-wall tc-home-page__breach-wall--front"
            aria-hidden="true"
            animate={{ x: [-10, 12, -16], y: [18, -10, 12], rotate: [-4, 6, -3] }}
            transition={{ duration: 5.6, repeat: Infinity, ease: [0.56, 0, 0.2, 1] }}
          />
          <div className="tc-home-page__breach-shard tc-home-page__breach-shard--left" />
          <div className="tc-home-page__breach-shard tc-home-page__breach-shard--right" />
          <div className="tc-home-page__breach-beam tc-home-page__breach-beam--top" />
          <div className="tc-home-page__breach-beam tc-home-page__breach-beam--bottom" />
          <div className="tc-home-page__breach-fog" />

          <motion.div
            className="tc-home-page__breach-meta"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32, ...HOME_STAGGER_TRANSITION }}
          >
            <Text className="tc-home-page__breach-kicker">进入 TapCanvas 创作现场</Text>
          </motion.div>

          <div className="tc-home-page__breach-core">
            <div className="tc-home-page__ritual-device">
              <div className="tc-home-page__ritual-device-shell">
                <div className="tc-home-page__ritual-device-accent" aria-hidden="true" />
                <Anchor className="tc-home-page__ritual-link" href={workspaceUrl}>
                  <span className="tc-home-page__ritual-copy">
                    <span className="tc-home-page__ritual-step">立即进入</span>
                    <span className="tc-home-page__ritual-label">进入项目与章节工作台</span>
                  </span>
                  <span className="tc-home-page__ritual-arrow-wrap" aria-hidden="true">
                    <IconArrowRight className="tc-home-page__ritual-arrow" size={18} stroke={2} />
                  </span>
                </Anchor>
              </div>
            </div>

            <motion.div
              className="tc-home-page__breach-statement"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.54, ...HOME_STAGGER_TRANSITION }}
            >
              <Text className="tc-home-page__statement-main">创建项目，按章节稳定生产。</Text>
              <Text className="tc-home-page__statement-copy">
                进入后，先上传原文与确定画风，再逐章生成镜头、沉淀资产，并把连续结果稳定推进到下一章。
              </Text>
            </motion.div>
          </div>
        </motion.div>
      </motion.section>
    </main>
  )
}
