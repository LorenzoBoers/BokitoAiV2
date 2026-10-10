import { describe, expect, it } from 'vitest'
import {
  composeAvatarSignatureTemplateHtml,
  composeDefaultSignatureHtml,
  editorHtmlFromSignature,
  previewSignatureHtml,
  renderSignatureTemplate,
  signatureHtmlFromEditor,
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

  it('renders {{avatar}} as a photo or initials', () => {
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
    expect(without).toContain('AD')
    expect(without).not.toContain('{{avatar}}')
    const raster = renderSignatureTemplate('<p>{{avatar}}</p>', {
      name: 'Ada',
      avatarUrl: 'data:image/png;base64,iVBORw0KGgo=',
      language: 'en',
    })
    expect(raster).toContain('<img')
    expect(raster).toContain('data:image/png')
  })

  it('writes the greeting out and keeps the avatar slot', () => {
    const template = composeAvatarSignatureTemplateHtml('nl')
    expect(template).toContain('Met vriendelijke groet')
    expect(template).not.toContain('{{closing}}')
    expect(template).toContain('{{avatar}}')
    const visual = editorHtmlFromSignature(template, {
      name: 'Lorenzo Boers',
      language: 'nl',
    })
    expect(visual).toContain('data-sig-avatar="1"')
    expect(visual).toContain('LB')
    expect(visual).not.toContain('{{avatar}}')
    expect(signatureHtmlFromEditor(visual)).toContain('{{avatar}}')
    expect(signatureHtmlFromEditor(visual)).not.toContain('data-sig-avatar')
  })
})
