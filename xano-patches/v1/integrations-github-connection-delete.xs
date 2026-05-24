// DELETE /api:integrations/github/connection - revoke all GitHub connections for tenant (legacy alias)
query "github/connection" verb=DELETE {
  api_group = "integrations"
  auth = "user"

  input {
    uuid connection_id?
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

    conditional {
      if ($input.connection_id != null) {
        db.edit integration_connections {
          field_name = "id"
          field_value = $input.connection_id
          data = {status: "revoked", updated_at: now}
        }

        db.edit github_connections {
          field_name = "id"
          field_value = $input.connection_id
          data = {status: "revoked", updated_at: now}
        }
      }

      else {
        db.query integration_providers {
          where = $db.integration_providers.slug == "github"
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $prov_rows

        conditional {
          if (($prov_rows|count) > 0) {
            db.query integration_connections {
              where = $db.integration_connections.tenant_id == $me.organisation_id && $db.integration_connections.provider_id == ($prov_rows|first).id
              return = {type: "list"}
            } as $ic_rows

            foreach ($ic_rows) {
              each as $ic {
                db.edit integration_connections {
                  field_name = "id"
                  field_value = $ic.id
                  data = {status: "revoked", updated_at: now}
                }
              }
            }
          }
        }

        db.query github_connections {
          where = $db.github_connections.tenant_id == $me.organisation_id
          return = {type: "list"}
        } as $rows

        foreach ($rows) {
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

  response = {ok: true}
}
