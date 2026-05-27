table "workspace_doc_blocks" {
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
      description = "Workspace doc root"
    }

    uuid page_id {
      table = "workspace_doc_pages"
      description = "Page containing this block"
    }

    uuid parent_block_id? {
      description = "Parent block for nested content"
    }

    text block_type filters=trim {
      description = "Block type (heading_1, paragraph, callout, ...). Named block_type to avoid db.query return {type: list} collision."
    }

    json text? {
      description = "Inline text runs"
    }

    json props? {
      description = "Type-specific properties"
    }

    int position?=0 {
      description = "Order among siblings"
    }

    enum created_by_type? {
      values = ["user", "agent"]
    }

    text created_by_id? {
      description = "Creator id (user int or agent uuid as string)"
    }

    enum last_edited_by_type? {
      values = ["user", "agent"]
    }

    text last_edited_by_id? {
      description = "Last editor id"
    }

    timestamp updated_at?=now {
      description = "Last update"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [
        {name: "page_id", op: "asc"}
        {name: "parent_block_id", op: "asc"}
        {name: "position", op: "asc"}
      ]
    }
    {type: "btree", field: [{name: "workspace_doc_id", op: "asc"}]}
  ]
}
