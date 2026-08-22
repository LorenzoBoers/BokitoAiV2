import { appRoutes } from '../api/routes/app.routes'
import { apiGet, apiPatch } from './api'

/** Server-persisted first-run tour state (per user, `User.settings_json.tour`). */
export type TourState = {
  intro_done?: boolean
  completed?: boolean
  dismissed?: boolean
  version?: number
}

type PreferencesResponse = {
  ui_language?: string
  tour?: TourState
}

export async function getTourState(token: string): Promise<TourState> {
  const res = await apiGet<PreferencesResponse>(appRoutes.me.preferences, token)
  return res.tour ?? {}
}

export async function patchTourState(token: string, tour: TourState): Promise<TourState> {
  const res = await apiPatch<PreferencesResponse>(appRoutes.me.preferences, { tour }, token)
  return res.tour ?? {}
}
