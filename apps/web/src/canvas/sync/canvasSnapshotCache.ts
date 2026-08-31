// Local IndexedDB snapshot cache for chapter canvas state.
// Lets ChapterCanvasPage paint immediately from the last known state while a
// fresh fetch is in-flight, eliminating the multi-hundred-ms blank canvas on
// repeat project access.
//
// Single-file, dependency-free wrapper — keeps a small `chapters` object store
// keyed by chapterId, with LRU eviction so we never grow past MAX_ENTRIES.

const DB_NAME = 'TapCanvasSnapshot'
const STORE_NAME = 'chapters'
const DB_VERSION = 1
const MAX_ENTRIES = 50

export type ChapterSnapshot = {
  chapterId: string
  revision: number
  nodes: unknown[]
  edges: unknown[]
  updatedAt: number
}

// 同步内存层：IndexedDB 之上再挂一个进程内 Map。IndexedDB 读取是异步的（至少晚一个宏任务，
// 且 ChapterCanvasPage 的 load() 又跑在 useEffect 里 → 必然在浏览器绘制之后才换图），
// 无法满足「切章那一帧就画对章节」。内存层让暖切（本会话访问过的章节）能在切章的
// useLayoutEffect 里【同步、绘制前】拿到目标章的图，杜绝旧章内容闪一帧。
const MEM_MAX_ENTRIES = 40
const memCache = new Map<string, ChapterSnapshot>()

function memTouch(snap: ChapterSnapshot): void {
  // Map 迭代按插入序 → 删了再塞实现 LRU：最近用的排到尾部。
  memCache.delete(snap.chapterId)
  memCache.set(snap.chapterId, snap)
  while (memCache.size > MEM_MAX_ENTRIES) {
    const oldest = memCache.keys().next().value
    if (oldest === undefined) break
    memCache.delete(oldest)
  }
}

/** 同步读取内存快照（无 await）。命中即可在切章 useLayoutEffect 里绘制前换图。 */
export function getChapterSnapshotSync(chapterId: string): ChapterSnapshot | null {
  return memCache.get(chapterId) ?? null
}

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'chapterId' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
  })
  // Reset promise on connection close so we re-open after browser eviction.
  dbPromise.then((db) => {
    db.onclose = () => { dbPromise = null }
    db.onversionchange = () => { db.close(); dbPromise = null }
  }).catch(() => { dbPromise = null })
  return dbPromise
}

export async function loadChapterSnapshot(chapterId: string): Promise<ChapterSnapshot | null> {
  try {
    const db = await getDb()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(chapterId)
      req.onsuccess = () => {
        const snap = (req.result as ChapterSnapshot | undefined) ?? null
        // 从 IndexedDB 读到就顺手灌进同步内存层，下次切回本章可绘制前秒绘。
        if (snap) memTouch(snap)
        resolve(snap)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function saveChapterSnapshot(snap: ChapterSnapshot): Promise<void> {
  // 先同步写内存层（即便随后 IndexedDB 落盘失败也不影响暖切秒绘）。
  memTouch(snap)
  try {
    const db = await getDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(snap)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
    // Fire-and-forget LRU eviction — only kicks in once per ~20 saves.
    if (Math.random() < 0.05) void evictIfOverflow()
  } catch {
    // Quota exceeded or DB unavailable — skip persistence silently.
  }
}

async function evictIfOverflow(): Promise<void> {
  try {
    const db = await getDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const countReq = store.count()
      countReq.onsuccess = () => {
        const overflow = countReq.result - MAX_ENTRIES
        if (overflow <= 0) { resolve(); return }
        let removed = 0
        const cursorReq = store.index('updatedAt').openCursor()
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result
          if (!cursor || removed >= overflow) { resolve(); return }
          cursor.delete()
          removed += 1
          cursor.continue()
        }
        cursorReq.onerror = () => resolve()
      }
      countReq.onerror = () => resolve()
    })
  } catch {
    // ignore
  }
}
