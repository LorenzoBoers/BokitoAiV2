import { describe, expect, it } from 'vitest'
import {
  composeDefaultSignatureHtml,
  previewSignatureHtml,
  renderSignatureTemplate,
} from './default-signature'

describe('default-signature', () => {
  it('substitutes placeholders and drops empty phone labels', () => {
    const html = renderSignatureTemplate(
      '<p><strong>{{name}}</strong><br>{{company}}<br>T: {{phone}}<br>E: {{email}}</p>',
      {
        name: 'Ada',
        company: 'Acme',
        email: 'ada@example.com',
        phone: '',
        language: 'en',
      },
    )
    expect(html).toContain('Ada')
    expect(html).toContain('Acme')
    expect(html).toContain('ada@example.com')
    expect(html).not.toContain('{{')
    expect(html).not.toContain('T:')
  })

  it('composes a modern default with round avatar', () => {
    const html = composeDefaultSignatureHtml({
      name: 'Lorenzo',
      email: 'lorenzo@bokito.ai',
      jobTitle: 'Founder',
      company: 'Bokito',
      language: 'nl',
    })
    expect(html).toContain('Met vriendelijke groet')
    expect(html).toContain('Lorenzo')
    expect(html).toContain('Founder')
    expect(html).toContain('border-radius:50%')
    expect(html).toContain('data:image/svg+xml')
  })

  it('preview uses default when template is empty', () => {
    const html = previewSignatureHtml('', {
      name: 'Ada',
      email: 'ada@example.com',
      language: 'en',
    })
    expect(html).toContain('Kind regards')
    expect(html).toContain('Ada')
  })
})
