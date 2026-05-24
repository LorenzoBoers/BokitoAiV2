// GET /api:integrations/integrations/connections/{connection_id}/resources - provider resources (GitHub repos)
query "integrations/connections/{connection_id}/resources" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
    uuid connection_id
    text resource_type? filters=trim
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

    precondition ($conn != null && $conn.tenant_id == $me.organisation_id && $conn.status == "active") {
      error_type = "accessdenied"
      error = "Connection not found."
    }

    db.query integration_providers {
      where = $db.integration_providers.id == $conn.provider_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $prov_rows

    var $provider {
      value = $prov_rows|first
    }

    var $access_token {
      value = $conn.credentials.access_token|to_text
    }

    var $items {
      value = []
    }

    conditional {
      if ($provider.slug == "github") {
        api.request {
          url = "https://api.github.com/user/repos"
          method = "GET"
          headers = [{name: "Authorization", value: "Bearer " ~ $access_token}, {name: "Accept", value: "application/vnd.github+json"}]
          params = {per_page: "100", sort: "updated"}
        } as $gh_res

        var.update $items {
          value = $gh_res.response.result
        }
      }
    }
  }

  response = {resource_type: "repos", items: $items}
}
