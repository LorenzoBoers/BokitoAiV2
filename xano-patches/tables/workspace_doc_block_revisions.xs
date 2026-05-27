table "workspace_doc_block_revisions" {
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
      description = "Page id"
    }

    uuid block_id {
      description = "Block id"
    }

    enum op {
      values = ["create", "update", "delete", "move"]
      description = "Revision operation"
    }

    json before? {
      description = "Block snapshot before change"
    }

    json after? {
      description = "Block snapshot after change"
    }

    enum actor_type {
      values = ["user", "agent"]
    }

    text actor_id? {
      description = "Actor id"
    }

    text actor_label? filters=trim {
      description = "Display label for actor"
    }

    text change_note? filters=trim {
      description = "Required note when actor is agent"
    }

    timestamp created_at?=now {
      description = "When the revision was recorded"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [{name: "page_id", op: "asc"}, {name: "created_at", op: "desc"}]
    }
    {type: "btree", field: [{name: "block_id", op: "asc"}]}
  ]
}
