import { Navigate } from 'react-router-dom'

/** Step-run detail is retired; send operators to the flows list. */
export default function WorkstreamRunDetail() {
  return <Navigate to="/flows" replace />
}
