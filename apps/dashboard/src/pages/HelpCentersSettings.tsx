import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { isBokitoMode } from '../lib/bokito-mode'
import {
  createKbCollection,
  deleteKbDocument,
  listKbCollections,
  listKbDocuments,
  uploadKbDocument,
  type KbCollection,
  type KbDocument,
} from '../lib/email-api'

export default function HelpCentersSettings() {
  const { token } = useAuth()
  const [kbCollections, setKbCollections] = useState<KbCollection[]>([])
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null)
  const [kbDocuments, setKbDocuments] = useState<KbDocument[]>([])
  const [newCollectionName, setNewCollectionName] = useState('')
  const [newCollectionDescription, setNewCollectionDescription] = useState('')
  const [newDocName, setNewDocName] = useState('')
  const [newDocUrl, setNewDocUrl] = useState('')
  const [newDocType, setNewDocType] = useState<KbDocument['file_type']>('pdf')

  const refreshKbCollections = useCallback(async () => {
    if (!token) return
    const rows = await listKbCollections(token)
    setKbCollections(rows)
    if (!selectedCollectionId && rows.length > 0) {
      setSelectedCollectionId(rows[0].id)
    }
  }, [token, selectedCollectionId])

  const refreshKbDocuments = useCallback(async () => {
    if (!token || !selectedCollectionId) return
    const rows = await listKbDocuments(token, selectedCollectionId)
    setKbDocuments(rows)
  }, [token, selectedCollectionId])

  useEffect(() => {
    void refreshKbCollections()
  }, [refreshKbCollections])

  useEffect(() => {
    void refreshKbDocuments()
  }, [refreshKbDocuments])

  return (
    <PageContent width="xl" className="flex h-full min-h-0 flex-col gap-4 py-1">
      {isBokitoMode() ? (
        <Card className="border-border/80 bg-bg-elevated/40 p-4">
          <p className="text-sm font-medium text-text-heading">Coming soon</p>
          <p className="mt-1 text-sm text-text-secondary">
            Help center collections and document indexing will ship in a follow-up release. The UI below is
            a preview of the planned workflow.
          </p>
        </Card>
      ) : null}
      <p className="text-sm text-text-secondary">
        Manage collection sources for AI context and document indexing.
      </p>

      <Card className="p-4">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input
              className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
              placeholder="Nieuwe collectie naam"
              value={newCollectionName}
              onChange={(event) => setNewCollectionName(event.target.value)}
            />
            <input
              className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
              placeholder="Beschrijving (optioneel)"
              value={newCollectionDescription}
              onChange={(event) => setNewCollectionDescription(event.target.value)}
            />
            <Button
              onClick={() =>
                void (async () => {
                  if (!token || !newCollectionName.trim()) return
                  await createKbCollection(token, newCollectionName.trim(), newCollectionDescription.trim() || undefined)
                  setNewCollectionName('')
                  setNewCollectionDescription('')
                  await refreshKbCollections()
                })()
              }
            >
              Toevoegen
            </Button>
          </div>
        </Card>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
          <Card className="overflow-y-auto p-3">
            <div className="mb-2 text-xs text-text-muted">Collecties</div>
            <div className="space-y-1">
              {kbCollections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => setSelectedCollectionId(collection.id)}
                  className={`w-full rounded-md border px-2 py-2 text-left text-sm ${
                    selectedCollectionId === collection.id
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-secondary'
                  }`}
                >
                  <div>{collection.name}</div>
                  <div className="text-2xs opacity-80">{collection.document_count} documenten</div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="overflow-y-auto p-3">
            <div className="mb-2 text-xs text-text-muted">Documenten</div>
            {selectedCollectionId ? (
              <>
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
                  <input
                    className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
                    placeholder="Bestandsnaam"
                    value={newDocName}
                    onChange={(event) => setNewDocName(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
                    placeholder="Bestand URL"
                    value={newDocUrl}
                    onChange={(event) => setNewDocUrl(event.target.value)}
                  />
                  <select
                    className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
                    value={newDocType}
                    onChange={(event) => setNewDocType(event.target.value as KbDocument['file_type'])}
                  >
                    {['pdf', 'docx', 'txt', 'md', 'csv'].map((type) => (
                      <option key={type} value={type}>
                        {type.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={() =>
                      void (async () => {
                        if (!token || !newDocName.trim() || !newDocUrl.trim()) return
                        await uploadKbDocument(token, selectedCollectionId, {
                          filename: newDocName.trim(),
                          file_url: newDocUrl.trim(),
                          file_type: newDocType,
                        })
                        setNewDocName('')
                        setNewDocUrl('')
                        await refreshKbDocuments()
                        await refreshKbCollections()
                      })()
                    }
                  >
                    Upload
                  </Button>
                </div>

                <div className="space-y-2">
                  {kbDocuments.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg border border-border/70 bg-bg-input/45 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-text-primary">{doc.filename}</div>
                        <div className="text-2xs text-text-muted">
                          {doc.file_type.toUpperCase()} - status: {doc.index_status}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void (async () => {
                            if (!token) return
                            await deleteKbDocument(token, doc.id)
                            await refreshKbDocuments()
                            await refreshKbCollections()
                          })()
                        }
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-sm text-text-muted">Selecteer eerst een collectie.</div>
            )}
        </Card>
      </div>
    </PageContent>
  )
}
