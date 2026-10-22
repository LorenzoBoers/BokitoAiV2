import { OrgEdgeFades } from '../components/org/OrgEdgeFades'
import { OrgStructureMap } from '../components/org/OrgStructureMap'

/** Grid: the relation map of the organization in 3D. How work runs lives on Workflow. */
export default function OrgCanvasPage() {
  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-bg" data-testid="grid-page">
      <div className="absolute inset-0">
        <OrgStructureMap />
      </div>
      <OrgEdgeFades />
    </div>
  )
}
