import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import {
  createKbCollection,
  deleteKbDocument,
  listKbCollections,
  listKbDocuments,
  uploadKbDocument,
  type KbCollection,
  type KbDocument,
} from '../lib/email-api'
import { humanizeLabel } from '../lib/labels'

function RowSkeleton() {
  return (
    <div className="animate-pulse rounded-md border border-border/50 bg-bg-input/40 px-2 py-2">
      <div className="h-3.5 w-2/3 rounded bg-bg-hover/70" />
      <div className="mt-1.5 h-2.5 w-1/3 rounded bg-bg-hover/50" />
    </div>
  )
}

export default function HelpCentersSettings() {
  const { token } = useAuth()
  const [kbCollections, setKbCollections] = useState<KbCollection[]>([])
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null)
  const [kbDocuments, setKbDocuments] = useState<KbDocument[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(true)
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [creatingCollection, setCreatingCollection] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [deletingDocId, setDeletingDocId] = useState<number | null>(null)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [newCollectionDescription, setNewCollectionDescription] = useState('')
  const [newDocName, setNewDocName] = useState('')
  const [newDocUrl, setNewDocUrl] = useState('')
  const [newDocType, setNewDocType] = useState<KbDocument['file_type']>('pdf')

  const refreshKbCollections = useCallback(async () => {
    if (!token) return
    try {
      const rows = await listKbCollections(token)
      setKbCollections(rows)
      setSelectedCollectionId((prev) => {
        if (prev != null && rows.some((row) => row.id === prev)) return prev
        return rows[0]?.id ?? null
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load collections')
    } finally {
      setCollectionsLoading(false)
    }
  }, [token])

  const refreshKbDocuments = useCallback(async () => {
    if (!token || !selectedCollectionId) return
    setDocumentsLoading(true)
    try {
      const rows = await listKbDocuments(token, selectedCollectionId)
      setKbDocuments(rows)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load documents')
    } finally {
      setDocumentsLoading(false)
    }
  }, [token, selectedCollectionId])

  useEffect(() => {
    void refreshKbCollections()
  }, [refreshKbCollections])

  useEffect(() => {
    void refreshKbDocuments()
  }, [refreshKbDocuments])

  return (
    <PageContent width="xl" className="flex h-full min-h-0 flex-col gap-4 py-1">
      <p className="text-sm text-text-secondary">
        Manage collection sources for AI context and document indexing.
      </p>

      <Card className="p-4">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input
              className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
              placeholder="New collection name"
              value={newCollectionName}
              disabled={creatingCollection}
              onChange={(event) => setNewCollectionName(event.target.value)}
            />
            <input
              className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
              placeholder="Description (optional)"
              value={newCollectionDescription}
              disabled={creatingCollection}
              onChange={(event) => setNewCollectionDescription(event.target.value)}
            />
            <Button
              disabled={creatingCollection || !newCollectionName.trim()}
              onClick={() =>
                void (async () => {
                  if (!token || !newCollectionName.trim()) return
                  setCreatingCollection(true)
                  try {
                    await createKbCollection(token, newCollectionName.trim(), newCollectionDescription.trim() || undefined)
                    setNewCollectionName('')
                    setNewCollectionDescription('')
                    await refreshKbCollections()
                    toast.success('Collection created')
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Could not create collection')
                  } finally {
                    setCreatingCollection(false)
                  }
                })()
              }
            >
              {creatingCollection ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </Card>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
          <Card className="overflow-y-auto p-3">
            <div className="mb-2 text-xs text-text-muted">Collections</div>
            <div className="space-y-1">
              {collectionsLoading ? (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              ) : kbCollections.length === 0 ? (
                <p className="px-2 py-3 text-sm text-text-muted">
                  No collections yet. Create one above to start indexing documents.
                </p>
              ) : (
                kbCollections.map((collection) => (
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
                  <div className="text-2xs opacity-80">{collection.document_count} documents</div>
                </button>
              ))
              )}
            </div>
          </Card>

          <Card className="overflow-y-auto p-3">
            <div className="mb-2 text-xs text-text-muted">Documents</div>
            {selectedCollectionId ? (
              <>
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
                  <input
                    className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
                    placeholder="File name"
                    value={newDocName}
                    disabled={uploadingDoc}
                    onChange={(event) => setNewDocName(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
                    placeholder="File URL"
                    value={newDocUrl}
                    disabled={uploadingDoc}
                    onChange={(event) => setNewDocUrl(event.target.value)}
                  />
                  <select
                    className="rounded-lg border border-border/70 bg-bg-input/80 px-3 py-2 text-sm"
                    value={newDocType}
                    disabled={uploadingDoc}
                    onChange={(event) => setNewDocType(event.target.value as KbDocument['file_type'])}
                  >
                    {['pdf', 'docx', 'txt', 'md', 'csv'].map((type) => (
                      <option key={type} value={type}>
                        {type.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={uploadingDoc || !newDocName.trim() || !newDocUrl.trim()}
                    onClick={() =>
                      void (async () => {
                        if (!token || !newDocName.trim() || !newDocUrl.trim()) return
                        setUploadingDoc(true)
                        try {
                          await uploadKbDocument(token, selectedCollectionId, {
                            filename: newDocName.trim(),
                            file_url: newDocUrl.trim(),
                            file_type: newDocType,
                          })
                          setNewDocName('')
                          setNewDocUrl('')
                          await refreshKbDocuments()
                          await refreshKbCollections()
                          toast.success('Document added')
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : 'Could not add document')
                        } finally {
                          setUploadingDoc(false)
                        }
                      })()
                    }
                  >
                    {uploadingDoc ? 'Uploading...' : 'Upload'}
                  </Button>
                </div>

                <div className="space-y-2">
                  {documentsLoading ? (
                    <>
                      <RowSkeleton />
                      <RowSkeleton />
                    </>
                  ) : kbDocuments.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-text-muted">
                      No documents in this collection yet. Add one above.
                    </p>
                  ) : (
                    kbDocuments.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg border border-border/70 bg-bg-input/45 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-text-primary">{doc.filename}</div>
                        <div className="text-2xs text-text-muted">
                          {doc.file_type.toUpperCase()} - {humanizeLabel(doc.index_status)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deletingDocId === doc.id}
                        onClick={() =>
                          void (async () => {
                            if (!token) return
                            setDeletingDocId(doc.id)
                            try {
                              await deleteKbDocument(token, doc.id)
                              await refreshKbDocuments()
                              await refreshKbCollections()
                              toast.success('Document removed')
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : 'Could not remove document')
                            } finally {
                              setDeletingDocId(null)
                            }
                          })()
                        }
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-text-muted">Select a collection first.</div>
            )}
        </Card>
      </div>
    </PageContent>
  )
}
