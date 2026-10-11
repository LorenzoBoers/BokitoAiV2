import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import {
  findEmailQuoteRoots,
  hasEmailQuoteMarkers,
  looksLikeDeliveryNotice,
  plainTextToQuotedHtml,
  preferPlainDeliveryNotice,
  setQuoteRootsCollapsed,
  splitPlainEmailQuote,
} from './mail-quote'

function docFrom(html: string): Document {
  return new JSDOM(
    `<!DOCTYPE html><html><body><div id="bokito-email-root">${html}</div></body></html>`,
  ).window.document
}

describe('delivery notices', () => {
  it('treats a mail-system explanation as the message to show', () => {
    const plain =
      'This is the mail system at host relay.mailchannels.net.\n\n' +
      'I\'m sorry to have to inform you that your message could not be delivered to one or more recipients.'
    expect(looksLikeDeliveryNotice(plain)).toBe(true)
    expect(preferPlainDeliveryNotice(plain, 'QA undo2 — retract Met vriendelijke groet')).toBe(true)
    expect(preferPlainDeliveryNotice('Hallo, korte vraag.', plain)).toBe(false)
    expect(preferPlainDeliveryNotice(plain, plain)).toBe(false)
  })
})

describe('plainTextToQuotedHtml', () => {
  it('keeps the full text out of the sendable body as a quote', () => {
    const html = plainTextToQuotedHtml('Regel een\n\nRegel twee <b>')
    expect(html.startsWith('<blockquote')).toBe(true)
    expect(html).toContain('Regel een')
    expect(html).toContain('Regel twee')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })
})

describe('splitPlainEmailQuote', () => {
  it('keeps the new message and folds the Outlook trail', () => {
    const text = [
      'Wat bedoel je?',
      '',
      'Met vriendelijke groet,',
      'Lorenzo',
      '',
      'Van: Bokito Admin <lorenzo@bokito.ai>',
      'Verzonden: donderdag 8 oktober 2026 19:48',
      'Aan: lorenzo_boers@outlook.com',
      'Onderwerp: test',
      '',
      'duss',
    ].join('\n')
    const { head, quote } = splitPlainEmailQuote(text)
    expect(head).toContain('Wat bedoel je?')
    expect(head).not.toContain('Van:')
    expect(quote).toContain('Van:')
    expect(quote).toContain('duss')
  })

  it('returns no quote when there is only the new message', () => {
    expect(splitPlainEmailQuote('Hallo, korte vraag.').quote).toBeNull()
  })
})

describe('findEmailQuoteRoots', () => {
  it('wraps an hr + Van/Verzonden trail', () => {
    const doc = docFrom(
      `<div>Wat bedoel je?<br>Met vriendelijke groet,</div>` +
        `<hr>` +
        `<p><b>Van:</b> Bokito Admin</p>` +
        `<p><b>Verzonden:</b> donderdag 8 oktober 2026 19:48</p>` +
        `<p><b>Aan:</b> jij</p>` +
        `<p><b>Onderwerp:</b> test</p>` +
        `<p>duss</p>`,
    )
    const roots = findEmailQuoteRoots(doc)
    expect(roots.length).toBeGreaterThan(0)
    setQuoteRootsCollapsed(roots, true)
    expect(roots[0].hidden).toBe(true)
    expect(roots[0].style.display).toBe('none')
    expect(doc.body.textContent).toContain('Wat bedoel je?')
  })

  it('finds a gmail_quote block', () => {
    const doc = docFrom(`<div>Nieuw</div><div class="gmail_quote">oud</div>`)
    const roots = findEmailQuoteRoots(doc)
    expect(roots).toHaveLength(1)
    expect(roots[0].classList.contains('gmail_quote')).toBe(true)
  })

  function visibleEmailText(doc: Document): string {
    const root = doc.getElementById('bokito-email-root')
    if (!root) return ''
    const clone = root.cloneNode(true) as HTMLElement
    clone.querySelectorAll('*').forEach((node) => {
      const el = node as HTMLElement
      if (el.hidden || el.style?.display === 'none') el.remove()
    })
    return (clone.textContent || '').replace(/\s+/g, ' ').trim()
  }

  it('keeps the new reply when a bokito-quote trail follows the signature', () => {
    const doc = docFrom(
      `<div>Hoi Lorenzo,<br/><br/>Bokito is een operations-platform.</div>` +
        `<br><br><p style="margin:0 0 14px 0">Met vriendelijke groet,</p>` +
        `<table><tr><td>Lorenzo Boers</td></tr></table>` +
        `<br><div class="bokito-quote"><hr>` +
        `<div dir="ltr"><b>Van:</b> Lorenzo Boers<br>` +
        `<b>Verzonden:</b> 10-10-2026<br>` +
        `<b>Aan:</b> lorenzo@bokito.ai<br>` +
        `<b>Onderwerp:</b> Mag ik vragen wie jullie zijn?</div>` +
        `<br><div dir="ltr">Wie zijn jullie en wat doen jullie?</div></div>`,
    )
    const roots = findEmailQuoteRoots(doc)
    expect(roots.length).toBeGreaterThan(0)
    expect(roots.some((r) => r.classList.contains('bokito-quote'))).toBe(true)
    expect(roots.some((r) => r.id === 'bokito-email-root')).toBe(false)
    setQuoteRootsCollapsed(roots, true)
    const visible = visibleEmailText(doc)
    expect(visible).toContain('Hoi Lorenzo')
    expect(visible).toContain('operations-platform')
    expect(visible).not.toContain('Wie zijn jullie')
  })

  it('does not collapse the whole letter when only a nested Van/Verzonden exists', () => {
    const doc = docFrom(
      `<div>Hoi Lorenzo, kort antwoord.</div>` +
        `<div><b>Van:</b> A<br><b>Verzonden:</b> gisteren<br><b>Aan:</b> B<br><b>Onderwerp:</b> x</div>`,
    )
    const roots = findEmailQuoteRoots(doc)
    expect(roots.some((r) => r.id === 'bokito-email-root')).toBe(false)
    setQuoteRootsCollapsed(roots, true)
    const visible = visibleEmailText(doc)
    expect(visible).toContain('Hoi Lorenzo')
    expect(visible).toContain('kort antwoord')
  })

  it('detects markers in raw html', () => {
    expect(hasEmailQuoteMarkers('<div class="gmail_quote">x</div>')).toBe(true)
    expect(hasEmailQuoteMarkers('<p>Van: a</p><p>Verzonden: b</p>')).toBe(true)
    expect(hasEmailQuoteMarkers('<p>Korte vraag</p>')).toBe(false)
  })
})
