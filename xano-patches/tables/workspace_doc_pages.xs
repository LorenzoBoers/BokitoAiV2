table "workspace_doc_pages" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    uuid tenant_id {
      description = "Organisation (tenant)"
    }

    uuid workspace_doc_id {
      table = "workspace_docs"
      description = "Parent workspace doc"
    }

    uuid parent_page_id? {
      description = "Parent page for nested chapters"
    }

    text title filters=trim {
      description = "Page title"
    }

    text slug filters=trim {
      description = "URL slug, unique per workspace doc"
    }

    text icon? filters=trim {
      description = "Lucide icon name"
    }

    enum kind? {
      values = [
        "overview"
        "vision"
        "features"
        "brand"
        "tech"
        "marketing"
        "operations"
        "roadmap"
        "log"
        "notes"
        "custom"
      ]
      description = "Page kind for navigation and AI context"
    }

    bool is_pinned?=0 {
      description = "Pinned in sidebar"
    }

    bool is_locked?=0 {
      description = "When true, block edits are blocked"
    }

    int position?=0 {
      description = "Sibling order"
    }

    int content_version?=0 {
      description = "Optimistic concurrency version; incremented on each block batch"
    }

    text rendered_markdown? filters=trim {
      description = "Derived markdown projection for export and indexing"
    }

    text rendered_plaintext? filters=trim {
      description = "Derived plain-text projection for RAG chunking"
    }

    text content_hash? filters=trim {
      description = "Hash of rendered_plaintext; skip reindex when unchanged"
    }

    timestamp last_indexed_at? {
      description = "When this page was last indexed into index_chunks"
    }

    timestamp archived_at? {
      description = "Soft delete timestamp"
    }

    timestamp updated_at?=now {
      description = "Last update"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [{name: "workspace_doc_id", op: "asc"}, {name: "position", op: "asc"}]
    }
    {
      type : "btree|unique"
      field: [{name: "workspace_doc_id", op: "asc"}, {name: "slug", op: "asc"}]
    }
  ]
}
