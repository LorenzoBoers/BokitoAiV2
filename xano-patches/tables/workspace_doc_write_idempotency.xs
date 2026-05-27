table "workspace_doc_write_idempotency" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    uuid tenant_id {
      description = "Organisation (tenant)"
    }

    text idempotency_key filters=trim {
      description = "Client-supplied idempotency key for agent batch writes"
    }

    uuid page_id {
      description = "Page the batch targeted"
    }

    json response? {
      description = "Cached batch response for replay"
    }

    timestamp created_at?=now {
      description = "When the idempotent write was recorded"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree|unique"
      field: [{name: "tenant_id", op: "asc"}, {name: "idempotency_key", op: "asc"}]
    }
  ]
}
