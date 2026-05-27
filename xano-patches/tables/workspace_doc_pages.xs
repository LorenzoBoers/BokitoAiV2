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
