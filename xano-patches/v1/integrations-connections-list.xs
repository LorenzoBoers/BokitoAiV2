// GET /api:integrations/integrations/connections - tenant connections
query "integrations/connections" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
    text provider? filters=trim
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

    var $provider_id {
      value = null
    }

    conditional {
      if ($input.provider != null && ($input.provider|strlen) > 0) {
        db.query integration_providers {
          where = $db.integration_providers.slug == $input.provider
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $prov_rows

        conditional {
          if (($prov_rows|count) > 0) {
            var.update $provider_id {
              value = ($prov_rows|first).id
            }
          }
        }
      }
    }

    var $rows {
      value = []
    }

    conditional {
      if ($input.provider != null && ($input.provider|strlen) > 0 && $provider_id == null) {
        var.update $rows {
          value = []
        }
      }

      elseif ($provider_id != null) {
        db.query integration_connections {
          where = $db.integration_connections.tenant_id == $me.organisation_id && $db.integration_connections.provider_id == $provider_id
          sort = {integration_connections.created_at: "desc"}
          return = {type: "list"}
        } as $filtered_rows

        var.update $rows {
          value = $filtered_rows
        }
      }

      else {
        db.query integration_connections {
          where = $db.integration_connections.tenant_id == $me.organisation_id
          sort = {integration_connections.created_at: "desc"}
          return = {type: "list"}
        } as $all_rows

        var.update $rows {
          value = $all_rows
        }
      }
    }

    var $safe {
      value = $rows|map:$$|pick: ["id", "tenant_id", "provider_id", "external_account_id", "display_name", "status", "metadata", "connected_by_user_id", "created_at", "updated_at"]
    }
  }

  response = {connections: $safe}
}
