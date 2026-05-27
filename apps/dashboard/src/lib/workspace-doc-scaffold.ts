import type { DocPageKind, InlineRun } from './doc-api'
import { slugifyPageTitle } from './doc-blocks'
import { applyWorkspaceBlockOps, createWorkspaceDocPage } from './workspace-doc-api'

export interface WorkspaceDocScaffoldPage {
  slug: string
  title: string
  kind: DocPageKind
  icon: string
  callout: string
  paragraph: string
}

/** Default hub documentation chapters (mirrors project PRD scaffold). */
export const WORKSPACE_DOC_SCAFFOLD_PAGES: WorkspaceDocScaffoldPage[] = [
  {
    slug: 'overview',
    title: 'Overview',
    kind: 'overview',
    icon: 'FileText',
    callout:
      'A one-paragraph snapshot of your workspace documentation. Update when priorities change.',
    paragraph:
      'Central documentation for your organisation: products, processes, brand, and operations.',
  },
  {
    slug: 'vision-and-audience',
    title: 'Vision and audience',
    kind: 'vision',
    icon: 'Telescope',
    callout: 'Where the organisation aims to go and who it serves.',
    paragraph: 'Describe the long-term vision and the audiences or customers you serve.',
  },
  {
    slug: 'features-and-scope',
    title: 'Features and scope',
    kind: 'features',
    icon: 'Layers',
    callout: 'Capabilities in scope, out of scope, and the rationale.',
    paragraph:
      'List capabilities in scope for your workspace today, and items explicitly out of scope.',
  },
  {
    slug: 'brand-and-voice',
    title: 'Brand and voice',
    kind: 'brand',
    icon: 'Sparkles',
    callout: 'Tone, naming, visual style, and writing rules for agents.',
    paragraph:
      'Describe how your organisation sounds and looks. What words you use and what you avoid.',
  },
  {
    slug: 'tech-stack',
    title: 'Tech stack',
    kind: 'tech',
    icon: 'Code',
    callout: 'Languages, frameworks, hosting, and integrations.',
    paragraph: 'List the major technical building blocks used across projects.',
  },
  {
    slug: 'marketing',
    title: 'Marketing',
    kind: 'marketing',
    icon: 'Megaphone',
    callout: 'Channels, campaigns, and positioning.',
    paragraph: 'Describe how you reach your audience across products and projects.',
  },
  {
    slug: 'operations',
    title: 'Operations',
    kind: 'operations',
    icon: 'Settings',
    callout: 'Day-to-day SOPs, support patterns, and incident response.',
    paragraph: 'Describe how the organisation runs day to day. SLAs, escalation paths, runbooks.',
  },
  {
    slug: 'roadmap',
    title: 'Roadmap',
    kind: 'roadmap',
    icon: 'Map',
    callout: 'Upcoming milestones. Agents use roadmap pages for planning context.',
    paragraph: 'List upcoming milestones and the order they should ship in.',
  },
]

function runs(text: string): InlineRun[] {
  return [{ text }]
}

/** Starter blocks for one scaffold page (heading, callout, paragraph). */
export async function seedWorkspacePageStarterBlocks(
  pageId: string,
  def: WorkspaceDocScaffoldPage,
): Promise<void> {
  await applyWorkspaceBlockOps(pageId, [
    {
      op: 'create',
      type: 'heading_1',
      text: runs(def.title),
      position: 0,
    },
    {
      op: 'create',
      type: 'callout',
      text: runs(def.callout),
      props: { tone: 'info', icon: 'Info' },
      position: 1,
    },
    {
      op: 'create',
      type: 'paragraph',
      text: runs(def.paragraph),
      position: 2,
    },
  ])
}

/** Seed workspace doc pages + starter blocks when the tree is empty. */
export async function seedWorkspaceDocScaffoldIfEmpty(
  workspaceDocId: string,
  pages: { id: string }[],
): Promise<boolean> {
  if (pages.length > 0) return false
  if (!workspaceDocId) return false

  for (const def of WORKSPACE_DOC_SCAFFOLD_PAGES) {
    let page
    try {
      page = await createWorkspaceDocPage({
        workspace_doc_id: workspaceDocId,
        title: def.title,
        slug: def.slug,
        kind: def.kind,
        icon: def.icon,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/slug/i.test(message) && /unique|duplicate|clash/i.test(message)) {
        page = await createWorkspaceDocPage({
          workspace_doc_id: workspaceDocId,
          title: def.title,
          slug: `${def.slug}-${Date.now()}`,
          kind: def.kind,
          icon: def.icon,
        })
      } else {
        throw err
      }
    }
    await seedWorkspacePageStarterBlocks(page.id, def)
  }
  return true
}
