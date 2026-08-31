// 画布 presence 房间管理器：按 resourceId(projectId/chapterId) 分房，纯内存、无 IO。
export type PresenceConn = { userId: string; send: (data: string) => void };

const rooms = new Map<string, Set<PresenceConn>>();

export function addConn(resourceId: string, conn: PresenceConn): void {
  let set = rooms.get(resourceId);
  if (!set) { set = new Set(); rooms.set(resourceId, set); }
  set.add(conn);
}

export function removeConn(resourceId: string, conn: PresenceConn): void {
  const set = rooms.get(resourceId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) rooms.delete(resourceId);
}

export function broadcast(resourceId: string, message: string, sender: PresenceConn): void {
  const set = rooms.get(resourceId);
  if (!set) return;
  for (const conn of set) {
    if (conn === sender) continue;
    try { conn.send(message); } catch { set.delete(conn); }
  }
}

export function roomSize(resourceId: string): number {
  return rooms.get(resourceId)?.size ?? 0;
}
