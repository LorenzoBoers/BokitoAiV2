import { loadPreferences, patchPreferences, type Preferences } from './preferences'

/** Server-persisted first-run tour state (per user, `User.settings_json.tour`). */
export type TourState = {
  intro_done?: boolean
  completed?: boolean
  dismissed?: boolean
  version?: number
}

function tourOf(prefs: Preferences): TourState {
  const tour = prefs.tour
  return tour && typeof tour === 'object' ? (tour as TourState) : {}
}

export async function getTourState(token: string): Promise<TourState> {
  return tourOf(await loadPreferences(token))
}

export async function patchTourState(token: string, tour: TourState): Promise<TourState> {
  return tourOf(await patchPreferences({ tour }, token))
}
