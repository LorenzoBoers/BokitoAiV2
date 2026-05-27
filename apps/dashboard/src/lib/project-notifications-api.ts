import { projectsRoutes } from '../api/routes'
import { xanoGetWorkforce, xanoPatchWorkforce } from './xano'

export type NotificationEventType = 'decisions' | 'updates' | 'failures' | 'tokens'
export type NotificationChannel = 'desktop' | 'email' | 'mobile'

export interface ProjectNotificationPreference {
  event_type: NotificationEventType
  channel: NotificationChannel
  enabled: boolean
}

export interface ProjectNotificationPreferencesResponse {
  project_id: string
  preferences: ProjectNotificationPreference[]
}

export async function getProjectNotificationPrefs(
  projectId: string,
): Promise<ProjectNotificationPreferencesResponse> {
  return xanoGetWorkforce<ProjectNotificationPreferencesResponse>(
    projectsRoutes.notificationPreferences(projectId),
  )
}

export async function patchProjectNotificationPrefs(
  projectId: string,
  preferences: ProjectNotificationPreference[],
): Promise<ProjectNotificationPreferencesResponse> {
  return xanoPatchWorkforce<ProjectNotificationPreferencesResponse>(
    projectsRoutes.notificationPreferences(projectId),
    { preferences },
  )
}
