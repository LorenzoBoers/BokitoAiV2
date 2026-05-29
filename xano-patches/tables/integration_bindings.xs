table "integration_bindings" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    uuid tenant_id {
      description = "Organisation tenant id"
    }

    uuid connection_id {
      table = "integration_connections"
      description = "Source connection"
    }

    text binding_type filters=trim {
      description = "Binding type (project_repo, mailbox_primary, mcp_server)"
    }

    uuid project_id? {
      table = "projects"
      description = "Optional project scope"
    }

    json config?= {
      description = "Binding config"
    }

    enum status?=active {
      values = ["active", "revoked"]
      description = "Binding status"
    }

    timestamp created_at?=now {
      description = "Created at"
    }

    timestamp updated_at?=now {
      description = "Updated at"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [{name: "tenant_id", op: "asc"}, {name: "binding_type", op: "asc"}]
    }
  ]
}
