// GET /api:integrations/github/connections - list all active GitHub accounts for tenant
query "github/connections" verb=GET {
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

    db.query integration_providers {
      where = $db.integration_providers.slug == "github"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $prov_rows

    var $connections {
      value = []
    }

    conditional {
      if (($prov_rows|count) > 0) {
        db.query integration_connections {
          where = $db.integration_connections.tenant_id == $me.organisation_id && $db.integration_connections.provider_id == ($prov_rows|first).id && $db.integration_connections.status == "active"
          sort = {integration_connections.created_at: "desc"}
          return = {type: "list"}
        } as $ic_rows

        var $from_ic {
          value = $ic_rows|map:$$|pick: ["id", "display_name", "external_account_id", "status", "metadata", "created_at", "updated_at"]|map:$$|set:github_login:$$.display_name|set:connected_at:$$.created_at
        }

        var.update $connections {
          value = $from_ic
        }
      }
    }

    conditional {
      if (($connections|count) == 0) {
        db.query github_connections {
          where = $db.github_connections.tenant_id == $me.organisation_id && $db.github_connections.status == "active"
          sort = {github_connections.created_at: "desc"}
          return = {type: "list"}
        } as $gh_rows

        var.update $connections {
          value = $gh_rows|map:$$|pick: ["id", "github_login", "status", "created_at", "updated_at"]|map:$$|set:connected_at:$$.created_at
        }
      }
    }
  }

  response = {connections: $connections}
}
