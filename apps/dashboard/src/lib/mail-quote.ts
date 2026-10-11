/**
 * Find the quoted reply trail in an email HTML document so the timeline can
 * show only the new message by default and offer "Show full message".
 *
 * Outlook, Apple Mail and Gmail each mark the trail differently; we wrap a
 * common `data-bokito-quote` root around whatever we find.
 */

export const EMAIL_QUOTE_SELECTORS = [
  '.bokito-quote',
  '.gmail_quote',
  '.gmail_quote_container',
  '.gmail_extra',
  '#divRplyFwdMsg',
  '#mail-editor-reference-message-container',
  'blockquote[type="cite"]',
  'div[id="appendonsend"]',
].join(',')

/** Outlook / Apple Mail reply header block (Van:/From: + Sent/To/Subject). */
export function looksLikeOutlookHeaderText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || t.length > 900) return false
  if (!/\b(?:Van|From)\s*:/i.test(t)) return false
  return /\b(?:Verzonden|Sent|Aan|To|Onderwerp|Subject)\s*:/i.test(t)
}

/** Delivery-status text (DSN / mailer-daemon), matched near the start of the body. */
const DELIVERY_NOTICE_RE =
  /this is the mail system|mail delivery subsystem|undelivered mail returned to sender|delivery status notification|could not be delivered to one or more recipients/i

export function looksLikeDeliveryNotice(text: string): boolean {
  const sample = text.replace(/\r\n/g, '\n').slice(0, 1200)
  return Boolean(sample.trim()) && DELIVERY_NOTICE_RE.test(sample)
}

/**
 * A bounce often stores the failure explanation as plain text and the
 * original letter as HTML (nested message/rfc822). Prefer the plain
 * explanation when the HTML does not contain it.
 */
export function preferPlainDeliveryNotice(plain: string, htmlPlain: string): boolean {
  if (!looksLikeDeliveryNotice(plain)) return false
  return !looksLikeDeliveryNotice(htmlPlain)
}

/** Quoted trail for the compact composer: full text, sent apart from the reply. */
export function plainTextToQuotedHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const lines = escaped
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line || '&nbsp;')
    .join('<br>')
  return `<blockquote type="cite">${lines}</blockquote>`
}

export function looksLikeWroteLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  return (
    /^On .{10,120} wrote:$/i.test(t) ||
    /^Op .{10,120} schreef .+:$/i.test(t) ||
    /^-----Original Message-----$/i.test(t)
  )
}

/**
 * True when this block *opens* a quote trail. Parents that merely contain a
 * Van:/From: header deeper down (e.g. #bokito-email-root wrapping the whole
 * letter) must not match — otherwise the new message collapses away too.
 */
export function textOpensQuoteTrail(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || t.length > 900) return false
  if (looksLikeWroteLine(t)) return true
  const fromAt = t.search(/\b(?:Van|From)\s*:/i)
  // Allow a short separator before Van:/From: (hr noise, dashes), not a reply.
  if (fromAt < 0 || fromAt > 24) return false
  if (t.slice(0, fromAt).replace(/[-–—_|.\s]/g, '').length > 0) return false
  return looksLikeOutlookHeaderText(t.slice(fromAt))
}

/** True when HTML carries a reply trail the iframe should collapse. */
export function hasEmailQuoteMarkers(html: string): boolean {
  const raw = html.trim()
  if (!raw) return false
  if (
    /gmail_quote|blockquote\s[^>]*type\s*=\s*["']?cite|divRplyFwdMsg|Original Message|appendonsend/i.test(
      raw,
    )
  ) {
    return true
  }
  if (/\b(?:Van|From)\s*:/i.test(raw) && /\b(?:Verzonden|Sent|Aan|To|Onderwerp|Subject)\s*:/i.test(raw)) {
    return true
  }
  return false
}

/**
 * Split a plain-text body into the new message and the quoted trail.
 * Returns `quote: null` when there is nothing to fold.
 */
export function splitPlainEmailQuote(text: string): { head: string; quote: string | null } {
  const raw = text.replace(/\r\n/g, '\n')
  if (!raw.trim()) return { head: raw, quote: null }

  const patterns: RegExp[] = [
    /\n[-_]{2,}\s*\n\s*(?:Van|From)\s*:/i,
    /\n\s*(?:Van|From)\s*:\s*.+\n\s*(?:Verzonden|Sent)\s*:/i,
    /\nOn .{10,120} wrote:\s*\n/i,
    /\nOp .{10,120} schreef .+:\s*\n/i,
    /\n-----Original Message-----\s*\n/i,
  ]
  let cut = -1
  for (const re of patterns) {
    const m = re.exec(raw)
    if (m && m.index >= 0 && (cut < 0 || m.index < cut)) cut = m.index
  }
  if (cut < 0) return { head: raw, quote: null }
  // Keep the newline that starts the trail with the quote.
  const head = raw.slice(0, cut).replace(/\s+$/, '')
  const quote = raw.slice(cut).replace(/^\n/, '')
  if (!head.trim() || !quote.trim()) return { head: raw, quote: null }
  return { head, quote }
}

/**
 * Wrap `start` and every following sibling into one quote container so we can
 * hide the whole trail (Outlook often starts with <hr> then Van:/Verzonden:).
 */
function asHtmlElement(node: Node | null | undefined): HTMLElement | null {
  if (!node || node.nodeType !== 1) return null
  return node as HTMLElement
}

export function wrapFromNodeThroughEnd(start: Node): HTMLElement | null {
  const parent = asHtmlElement(start.parentNode)
  if (!parent) return null
  if (start.parentElement?.closest('[data-bokito-quote]')) return null
  const doc = start.ownerDocument
  if (!doc) return null
  const wrapper = doc.createElement('div')
  wrapper.setAttribute('data-bokito-quote', '1')
  parent.insertBefore(wrapper, start)
  let node: ChildNode | null = start as ChildNode
  while (node) {
    const next: ChildNode | null = node.nextSibling
    wrapper.appendChild(node)
    node = next
  }
  return wrapper
}

function hasTopBorder(el: HTMLElement, win: Window): boolean {
  const style = win.getComputedStyle(el)
  const width = Number.parseFloat(style.borderTopWidth || '0')
  if (!Number.isFinite(width) || width < 1) return false
  const color = style.borderTopColor || ''
  // Transparent / none borders do not mark a quote.
  if (!color || /transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/i.test(color)) return false
  return style.borderTopStyle !== 'none'
}

export function findEmailQuoteRoots(doc: Document): HTMLElement[] {
  const roots: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  const add = (el: HTMLElement | null) => {
    if (!el || seen.has(el)) return
    for (const existing of roots) {
      if (existing.contains(el)) return
      if (el.contains(existing)) {
        seen.delete(existing)
        roots.splice(roots.indexOf(existing), 1)
      }
    }
    seen.add(el)
    roots.push(el)
  }

  doc.querySelectorAll(EMAIL_QUOTE_SELECTORS).forEach((node) => {
    add(asHtmlElement(node))
  })

  // Horizontal rule that starts the quoted trail (common in Outlook replies).
  doc.querySelectorAll('hr').forEach((hrNode) => {
    const hr = asHtmlElement(hrNode)
    if (!hr) return
    if (hr.closest(EMAIL_QUOTE_SELECTORS) || hr.closest('[data-bokito-quote]')) return
    let peek = ''
    let sib: ChildNode | null = hr.nextSibling
    for (let i = 0; i < 6 && sib; i += 1, sib = sib.nextSibling) {
      peek += ` ${sib.textContent || ''}`
    }
    if (!looksLikeOutlookHeaderText(peek) && !looksLikeWroteLine(peek.trim())) return
    add(wrapFromNodeThroughEnd(hr))
  })

  // Outlook often uses a border-top div instead of <hr>.
  const win = doc.defaultView
  if (win) {
    const bordered = Array.from(doc.body?.querySelectorAll('div, p, span, table') ?? [])
    for (const raw of bordered) {
      const node = asHtmlElement(raw)
      if (!node) continue
      if (node.closest(EMAIL_QUOTE_SELECTORS) || node.closest('[data-bokito-quote]')) continue
      if (!hasTopBorder(node, win)) continue
      const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
      if (!looksLikeOutlookHeaderText(text) && !looksLikeWroteLine(text)) {
        // Header may start in the next sibling after a bare separator line.
        let peek = text
        let sib: ChildNode | null = node.nextSibling
        for (let i = 0; i < 6 && sib && peek.length < 400; i += 1, sib = sib.nextSibling) {
          peek += ` ${sib.textContent || ''}`
        }
        if (!looksLikeOutlookHeaderText(peek) && !looksLikeWroteLine(peek.trim())) continue
      }
      // Need some real reply above this trail.
      const before = (() => {
        let acc = ''
        let prev: ChildNode | null = node.previousSibling
        while (prev && acc.length < 80) {
          acc = `${prev.textContent || ''}${acc}`
          prev = prev.previousSibling
        }
        if (acc.trim()) return acc
        // Walk up: previous siblings of parents (Outlook nests the border div).
        let el: HTMLElement | null = node.parentElement
        while (el && el !== doc.body && acc.trim().length < 2) {
          let p: ChildNode | null = el.previousSibling
          while (p && acc.length < 80) {
            acc = `${p.textContent || ''}${acc}`
            p = p.previousSibling
          }
          el = el.parentElement
        }
        return acc
      })()
      if (before.replace(/\s+/g, ' ').trim().length < 2) continue
      add(wrapFromNodeThroughEnd(node) ?? node)
      if (roots.length > 0) break
    }
  }

  // Outlook / Apple Mail plain wrappers: "On … wrote" / "Op … schreef" /
  // Van:/From: header blocks without a leading <hr>.
  const walk = doc.body ? Array.from(doc.body.querySelectorAll('div, p, span, blockquote')) : []
  for (const raw of walk) {
    const node = asHtmlElement(raw)
    if (!node) continue
    // Never treat the iframe root as a quote — it always contains the trail.
    if (node.id === 'bokito-email-root') continue
    if (node.closest(EMAIL_QUOTE_SELECTORS) || node.closest('[data-bokito-quote]')) continue
    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
    if (!textOpensQuoteTrail(text)) continue
    // Need some real reply above this trail (sibling or ancestor sibling).
    let before = ''
    let prev: ChildNode | null = node.previousSibling
    while (prev && before.length < 80) {
      before = `${prev.textContent || ''}${before}`
      prev = prev.previousSibling
    }
    if (!before.trim()) {
      let el: HTMLElement | null = node.parentElement
      while (el && el !== doc.body && before.trim().length < 2) {
        let p: ChildNode | null = el.previousSibling
        while (p && before.length < 80) {
          before = `${p.textContent || ''}${before}`
          p = p.previousSibling
        }
        el = el.parentElement
      }
    }
    if (before.replace(/\s+/g, ' ').trim().length < 2) continue
    add(wrapFromNodeThroughEnd(node) ?? node)
  }

  // Outlook often splits Van:/Verzonden:/Aan:/Onderwerp: across sibling <p>s
  // — no single node holds the full header. Scan sibling windows.
  if (roots.length === 0) {
    const containers = [
      doc.getElementById('bokito-email-root'),
      doc.body,
      ...Array.from(doc.body?.querySelectorAll('div, td, blockquote') ?? []),
    ]
      .map((el) => asHtmlElement(el))
      .filter((el): el is HTMLElement => el != null)
    for (const container of containers) {
      if (container.closest('[data-bokito-quote]')) continue
      const kids = Array.from(container.childNodes).filter((n) => {
        if (n.nodeType === 1) return true
        return n.nodeType === 3 && Boolean(n.textContent?.trim())
      })
      for (let i = 0; i < kids.length; i += 1) {
        let joined = ''
        for (let j = i; j < Math.min(i + 8, kids.length); j += 1) {
          joined += `${kids[j].textContent || ''}\n`
          if (!looksLikeOutlookHeaderText(joined)) continue
          const before = kids
            .slice(0, i)
            .map((n) => n.textContent || '')
            .join('')
            .trim()
          if (before.length < 2) break
          add(wrapFromNodeThroughEnd(kids[i]))
          break
        }
        if (roots.length > 0) break
      }
      if (roots.length > 0) break
    }
  }
  return roots
}

/** Hide or show quote roots; `!important` beats mail CSS `display:block !important`. */
export function setQuoteRootsCollapsed(roots: HTMLElement[], collapsed: boolean) {
  for (const el of roots) {
    if (collapsed) {
      el.setAttribute('hidden', '')
      el.style.setProperty('display', 'none', 'important')
      el.style.setProperty('visibility', 'hidden', 'important')
      el.style.setProperty('height', '0', 'important')
      el.style.setProperty('overflow', 'hidden', 'important')
      el.style.setProperty('margin', '0', 'important')
      el.style.setProperty('padding', '0', 'important')
    } else {
      el.removeAttribute('hidden')
      el.style.removeProperty('display')
      el.style.removeProperty('visibility')
      el.style.removeProperty('height')
      el.style.removeProperty('overflow')
      el.style.removeProperty('margin')
      el.style.removeProperty('padding')
    }
  }
}
