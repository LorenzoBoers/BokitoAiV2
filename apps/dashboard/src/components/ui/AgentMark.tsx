import type { ComponentProps } from 'react'
import { Avatar } from './avatar'

type Props = Omit<Extract<ComponentProps<typeof Avatar>, { kind: 'agent' }>, 'kind'>

/** @deprecated Use `<Avatar kind="agent">`. */
export function AgentMark(props: Props) {
  return <Avatar kind="agent" {...props} />
}
