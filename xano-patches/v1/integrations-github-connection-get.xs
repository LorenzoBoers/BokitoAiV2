// GET /api:integrations/github/connection - tenant GitHub connection (no token)
query "github/connection" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
  }

  stack {
    db.get user {
      field_name = "id"
      field_value = $auth.id|to_int
    } as $me

    precondition ($me != null && $me.organisation_id != null) {
      error_type = "accessdenied"
      error = "No organisation context."
    }

    db.query github_connections {
      where = $db.github_connections.tenant_id == $me.organisation_id && $db.github_connections.status == "active"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    conditional {
      if (($rows|count) == 0) {
        var $empty {
          value = null
        }
      }
    }
  }

  response = ($rows|count) > 0 ? ($rows|first|pick: ["id", "github_login", "status", "created_at", "updated_at"]) : null
}
