import { APP_API_BASE } from './api.config'
import { appRoutes } from '../api/routes/app.routes'

export type UploadedAttachment = {
  id: string
  name: string
  mime: string
  size: number
  url: string
  schema_version?: number
}

export async function uploadAttachment(token: string, file: File): Promise<UploadedAttachment> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${APP_API_BASE}${appRoutes.uploads.create}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) {
    throw new Error(await res.text().catch(() => 'Upload failed'))
  }
  return (await res.json()) as UploadedAttachment
}
