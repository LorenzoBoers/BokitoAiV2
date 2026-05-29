table "github_connections" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    uuid tenant_id {
      description = "Organisation tenant id"
    }

    int connected_by_user_id? {
      description = "User who connected"
    }

    int github_user_id? {
      description = "GitHub user id"
    }

    text github_login filters=trim {
      description = "GitHub login"
    }

    password access_token? {
      description = "OAuth access token"
      sensitive = true
    }

    password refresh_token? {
      description = "OAuth refresh token"
      sensitive = true
    }

    timestamp token_expires_at? {
      description = "Token expiry"
    }

    text scopes? filters=trim {
      description = "Granted scopes"
    }

    enum status?=active {
      values = ["active", "revoked", "error"]
      description = "Connection status"
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
    {type: "btree", field: [{name: "tenant_id", op: "asc"}, {name: "status", op: "asc"}]}
  ]
}
