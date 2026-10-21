import { foldersRoutes } from '../api/routes'
import { foldersDelete, foldersGet, foldersPatch, foldersPost } from './api'

export interface ProjectRow {
  id: string
  name: string
  /** Server-chosen label: the folder name, else its distinguishing labels. Empty means unnamed. */
  display_name: string
  slug: string
  description?: string
  tag_ids: string[]
  tag_names: string[]
  sort_order?: number
  doc_sections_total?: number
  doc_sections_done?: number
  parent_id?: string | null
  child_count?: number
  ancestors?: { id: string; name: string; display_name: string; tag_ids?: string[]; tag_names?: string[] }[]
  children?: ProjectChild[]
  /** Present on list and detail reads; create and patch responses omit them. */
  open_count?: number
  closed_count?: number
  open_tickets_count?: number
  /** Legacy fields — may be absent on folder filterset API responses. */
  autonomous_scope?: string
  po_agent_id?: string | null
  po_agent?: { id: string; name: string; avatar_kind?: string | null; avatar_icon?: string | null; avatar_color?: string | null; avatar_image_url?: string | null } | null
}

export interface ProjectChild {
  id: string
  name: string
  display_name: string
  slug: string
  tag_ids?: string[]
  tag_names?: string[]
  child_count: number
  open_count: number
  closed_count: number
}

/** Counts from the API's one count rule: folder plus subtree, within your Communication hub. */
export type CountedProject = ProjectRow &
  Required<Pick<ProjectRow, 'open_count' | 'closed_count' | 'open_tickets_count'>>

export async function listProjects(): Promise<CountedProject[]> {
  const data = await foldersGet<CountedProject[] | { items: CountedProject[] }>(foldersRoutes.list)
  return Array.isArray(data) ? data : data.items ?? []
}

export async function getProject(projectId: string): Promise<CountedProject> {
  return foldersGet<CountedProject>(foldersRoutes.byId(projectId))
}

export async function createProject(input: {
  name?: string
  slug?: string
  description?: string
  tag_ids?: string[]
  tags?: string[]
  parent_id?: string | null
  sort_order?: number
}): Promise<ProjectRow> {
  return foldersPost<ProjectRow>(foldersRoutes.list, input)
}

export async function listFolderFiles(
  folderId: string,
): Promise<{ name: string; url?: string | null; signal_id: string; subject: string }[]> {
  const data = await foldersGet<{ files?: { name: string; url?: string | null; signal_id: string; subject: string }[] }>(
    foldersRoutes.files(folderId),
  )
  return data.files ?? []
}

export async function patchProject(
  projectId: string,
  patch: Partial<
    Pick<ProjectRow, 'name' | 'description' | 'sort_order' | 'parent_id'> & {
      tag_ids?: string[]
      tags?: string[]
    }
  >,
): Promise<ProjectRow> {
  return foldersPatch<ProjectRow>(foldersRoutes.byId(projectId), patch)
}

export async function nestFolder(
  folderId: string,
  ontoFolderId: string | null,
): Promise<ProjectRow> {
  return foldersPost<ProjectRow>(foldersRoutes.nest(folderId), {
    onto_folder_id: ontoFolderId,
  })
}

export async function deleteProject(projectId: string, confirmName: string): Promise<{ deleted: boolean }> {
  return foldersDelete<{ deleted: boolean }>(foldersRoutes.byId(projectId), {
    confirm_name: confirmName,
  }) as Promise<{ deleted: boolean }>
}
