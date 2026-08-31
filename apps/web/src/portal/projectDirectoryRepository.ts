import type {
  ProjectDirectorySnapshot,
  SaveProjectDirectoryRequest,
} from '@tapcanvas/project-directory-protocol'
import {
  getProjectDirectorySnapshot,
  saveProjectDirectorySnapshot,
} from '../api/server'

export type LoadedProjectDirectory = ProjectDirectorySnapshot

export function loadProjectDirectory(): Promise<LoadedProjectDirectory> {
  return getProjectDirectorySnapshot()
}

export function persistProjectDirectory(
  request: SaveProjectDirectoryRequest,
): Promise<ProjectDirectorySnapshot> {
  return saveProjectDirectorySnapshot(request)
}
