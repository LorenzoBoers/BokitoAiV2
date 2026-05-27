table "workspace_docs" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    uuid tenant_id {
      description = "Organisation (tenant) that owns this workspace doc"
    }

    text title filters=trim {
      description = "Workspace documentation title"
    }

    timestamp updated_at?=now {
      description = "Last update timestamp"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree|unique", field: [{name: "tenant_id", op: "asc"}]}
  ]
}
