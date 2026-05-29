table "integration_connections" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    uuid tenant_id {
      description = "Organisation tenant id"
    }

    uuid provider_id {
      table = "integration_providers"
      description = "Integration provider"
    }

    text external_account_id filters=trim {
      description = "Provider account id"
    }

    text display_name filters=trim {
      description = "Display name"
    }

    json credentials? {
      description = "Encrypted credentials"
      sensitive = true
    }

    enum status?=active {
      values = ["active", "revoked", "error"]
      description = "Connection status"
    }

    int connected_by_user_id? {
      description = "User who connected"
    }

    json metadata? {
      description = "Provider metadata"
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
      field: [{name: "tenant_id", op: "asc"}, {name: "provider_id", op: "asc"}]
    }
    {
      type : "btree|unique"
      field: [
        {name: "tenant_id", op: "asc"}
        {name: "provider_id", op: "asc"}
        {name: "external_account_id", op: "asc"}
      ]
    }
  ]
}
