import { OrgEdgeFades } from '../components/org/OrgEdgeFades'
import { OrgStructureMap } from '../components/org/OrgStructureMap'
import { WorkforceSectionTabs } from '../components/shell/SectionTabs'

/** Grid: the relation map of the organization in 3D. How work runs lives on Workflow. */
export default function OrgCanvasPage() {
  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-bg" data-testid="grid-page">
      <div className="absolute inset-0">
        <OrgStructureMap />
      </div>
      <OrgEdgeFades />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pb-3 pt-3">
        <div className="pointer-events-auto">
          <WorkforceSectionTabs className="-mx-1" />
        </div>
      </header>
    </div>
  )
}
