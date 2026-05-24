// DELETE /api:integrations/integrations/connections/{connection_id}
query "integrations/connections/{connection_id}" verb=DELETE {
  api_group = "integrations"
  auth = "user"

  input {
    uuid connection_id
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

    db.get integration_connections {
      field_name = "id"
      field_value = $input.connection_id
    } as $conn

    precondition ($conn != null && $conn.tenant_id == $me.organisation_id) {
      error_type = "accessdenied"
      error = "Connection not found."
    }

    db.edit integration_connections {
      field_name = "id"
      field_value = $input.connection_id
      data = {status: "revoked", updated_at: now}
    } as $updated

    db.query integration_bindings {
      where = $db.integration_bindings.connection_id == $input.connection_id && $db.integration_bindings.status == "active"
      return = {type: "list"}
    } as $bindings

    foreach ($bindings) {
      each as $b {
        db.edit integration_bindings {
          field_name = "id"
          field_value = $b.id
          data = {status: "revoked", updated_at: now}
        }
      }
    }

    db.query integration_providers {
      where = $db.integration_providers.id == $conn.provider_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $prov_rows

    conditional {
      if (($prov_rows|count) > 0 && ($prov_rows|first).slug == "github") {
        db.query github_connections {
          where = $db.github_connections.tenant_id == $me.organisation_id && $db.github_connections.github_user_id == ($conn.external_account_id|to_int)
          return = {type: "list"}
        } as $gh_rows

        foreach ($gh_rows) {
          each as $gh {
            db.edit github_connections {
              field_name = "id"
              field_value = $gh.id
              data = {status: "revoked", updated_at: now}
            }
          }
        }
      }
    }
  }

  response = {ok: true, id: $input.connection_id, status: "revoked"}
}
