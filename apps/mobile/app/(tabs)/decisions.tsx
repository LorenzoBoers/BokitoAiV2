import { Redirect } from 'expo-router'

/**
 * Decisions are inline in Messages threads. This tab deep-links to the
 * Messages inbox filtered to threads awaiting a decision.
 */
export default function DecisionsScreen() {
  return <Redirect href={{ pathname: '/inbox', params: { view: 'awaiting_decision' } }} />
}
