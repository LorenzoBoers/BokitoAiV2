import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
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
import { WEBSITE_WIDGET_PATH } from '../lib/assistant-settings-path'
import { indexStatusLabel } from '../lib/status-labels'

function RowSkeleton() {
  return (
    <div className="animate-pulse rounded-md border border-border/60 bg-bg-input/40 px-2 py-2">
      <div className="h-3.5 w-2/3 rounded bg-bg-hover/70" />
      <div className="mt-1.5 h-2.5 w-1/3 rounded bg-bg-hover/50" />
    </div>
  )
}

export default function HelpCentersSettings() {
  const { t } = useTranslation('nav')
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
      toast.error(error instanceof Error ? error.message : t('helpCentersPage.loadCollectionsError'))
    } finally {
      setCollectionsLoading(false)
    }
  }, [token, t])

  const refreshKbDocuments = useCallback(async () => {
    if (!token || !selectedCollectionId) return
    setDocumentsLoading(true)
    try {
      const rows = await listKbDocuments(token, selectedCollectionId)
      setKbDocuments(rows)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('helpCentersPage.loadDocumentsError'))
    } finally {
      setDocumentsLoading(false)
    }
  }, [token, selectedCollectionId, t])

  useEffect(() => {
    void refreshKbCollections()
  }, [refreshKbCollections])

  useEffect(() => {
    void refreshKbDocuments()
  }, [refreshKbDocuments])

  return (
    <PageContent width="xl" className="flex h-full min-h-0 flex-col gap-4 py-1">
      <p className="text-sm text-text-secondary">
        {t('helpCentersPage.intro')}{' '}
        <Link to="/knowledge" className="font-medium text-accent hover:underline">
          {t('helpCentersPage.openKnowledge')}
        </Link>
        {' · '}
        <Link to={WEBSITE_WIDGET_PATH} className="font-medium text-accent hover:underline">
          {t('helpCentersPage.openWidget')}
        </Link>
        .
      </p>

      <Card className="p-4">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input
              className="rounded-lg border border-border/60 bg-bg-input/80 px-3 py-2 text-sm"
              placeholder={t('helpCentersPage.collectionName')}
              value={newCollectionName}
              disabled={creatingCollection}
              onChange={(event) => setNewCollectionName(event.target.value)}
            />
            <input
              className="rounded-lg border border-border/60 bg-bg-input/80 px-3 py-2 text-sm"
              placeholder={t('helpCentersPage.descriptionOptional')}
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
                    toast.success(t('helpCentersPage.created'))
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('helpCentersPage.createError'))
                  } finally {
                    setCreatingCollection(false)
                  }
                })()
              }
            >
              {creatingCollection ? t('helpCentersPage.adding') : t('helpCentersPage.add')}
            </Button>
          </div>
        </Card>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
          <Card className="overflow-y-auto p-3">
            <div className="mb-2 text-xs text-text-muted">{t('helpCentersPage.collections')}</div>
            <div className="space-y-1">
              {collectionsLoading ? (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              ) : kbCollections.length === 0 ? (
                <div className="px-2 py-3">
                  <p className="text-sm text-text-muted">
                    {t('helpCentersPage.emptyCollections')}
                  </p>
                  <Link to="/knowledge" className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline">
                    {t('helpCentersPage.openKnowledge')}
                  </Link>
                </div>
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
                  <div className="text-2xs opacity-80">{t('helpCentersPage.documentsCount', { count: collection.document_count })}</div>
                </button>
              ))
              )}
            </div>
          </Card>

          <Card className="overflow-y-auto p-3">
            <div className="mb-2 text-xs text-text-muted">{t('helpCentersPage.documents')}</div>
            {selectedCollectionId ? (
              <>
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
                  <input
                    className="rounded-lg border border-border/60 bg-bg-input/80 px-3 py-2 text-sm"
                    placeholder={t('helpCentersPage.fileName')}
                    value={newDocName}
                    disabled={uploadingDoc}
                    onChange={(event) => setNewDocName(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-border/60 bg-bg-input/80 px-3 py-2 text-sm"
                    placeholder={t('helpCentersPage.fileUrl')}
                    value={newDocUrl}
                    disabled={uploadingDoc}
                    onChange={(event) => setNewDocUrl(event.target.value)}
                  />
                  <select
                    className="rounded-lg border border-border/60 bg-bg-input/80 px-3 py-2 text-sm"
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
                          toast.success(t('helpCentersPage.added'))
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t('helpCentersPage.addError'))
                        } finally {
                          setUploadingDoc(false)
                        }
                      })()
                    }
                  >
                    {uploadingDoc ? t('helpCentersPage.uploading') : t('helpCentersPage.upload')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {documentsLoading ? (
                    <>
                      <RowSkeleton />
                      <RowSkeleton />
                    </>
                  ) : kbDocuments.length === 0 ? (
                    <div className="px-1 py-2 text-sm text-text-muted">
                      <p>{t('helpCentersPage.emptyDocuments')}</p>
                      <Link
                        to="/knowledge"
                        className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline"
                      >
                        {t('helpCentersPage.openKnowledge')}
                      </Link>
                    </div>
                  ) : (
                    kbDocuments.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-bg-input/45 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-text-primary">{doc.filename}</div>
                        <div
                          className={
                            doc.index_status === 'failed' || doc.index_status === 'unsupported'
                              ? 'text-2xs text-danger'
                              : 'text-2xs text-text-muted'
                          }
                          title={doc.index_error ?? undefined}
                        >
                          {doc.file_type.toUpperCase()} - {indexStatusLabel(doc.index_status, t)}
                          {doc.index_error ? ` (${doc.index_error})` : ''}
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
                              toast.success(t('helpCentersPage.removed'))
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : t('helpCentersPage.removeError'))
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
            ) : kbCollections.length === 0 ? (
              <div className="px-1 py-2 text-sm text-text-muted">
                <p>{t('helpCentersPage.emptyDocumentsNoCollection')}</p>
                <Link to="/knowledge" className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline">
                  {t('helpCentersPage.openKnowledge')}
                </Link>
              </div>
            ) : (
              <div className="text-sm text-text-muted">{t('helpCentersPage.selectCollection')}</div>
            )}
        </Card>
      </div>
    </PageContent>
  )
}
