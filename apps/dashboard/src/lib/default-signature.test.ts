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

  it('composes a text-only default without avatar image', () => {
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
    expect(html).toContain('border-left:2px solid')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('data:image')
  })

  it('renders {{avatar}} only for https photos', () => {
    const withPhoto = renderSignatureTemplate('<p>{{avatar}}</p><p>{{name}}</p>', {
      name: 'Ada',
      avatarUrl: 'https://cdn.example.com/a.jpg',
      language: 'en',
    })
    expect(withPhoto).toContain('<img')
    expect(withPhoto).toContain('https://cdn.example.com/a.jpg')
    const without = renderSignatureTemplate('<p>{{avatar}}</p>', {
      name: 'Ada',
      avatarUrl: 'data:image/svg+xml;base64,abc',
      language: 'en',
    })
    expect(without).not.toContain('<img')
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
