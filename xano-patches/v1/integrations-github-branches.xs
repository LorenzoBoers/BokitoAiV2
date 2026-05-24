// GET /api:integrations/github/repos/{owner}/{repo}/branches
query "github/repos/{owner}/{repo}/branches" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
    text owner filters=trim
    text repo filters=trim
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

    var $access_token {
      value = ""
    }

    conditional {
      if ($input.connection_id != null) {
        db.get integration_connections {
          field_name = "id"
          field_value = $input.connection_id
        } as $ic

        precondition ($ic != null && $ic.tenant_id == $me.organisation_id && $ic.status == "active") {
          error_type = "inputerror"
          error = "Connection not found."
        }

        var.update $access_token {
          value = $ic.credentials.access_token|to_text
        }
      }

      else {
        db.query github_connections {
          where = $db.github_connections.tenant_id == $me.organisation_id && $db.github_connections.status == "active"
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $conn_rows

        precondition (($conn_rows|count) > 0) {
          error_type = "inputerror"
          error = "Connect GitHub first."
        }

        var.update $access_token {
          value = ($conn_rows|first).access_token|to_text
        }
      }
    }

    var $url {
      value = "https://api.github.com/repos/" ~ $input.owner ~ "/" ~ $input.repo ~ "/branches"
    }

    api.request {
      url = $url
      method = "GET"
      headers = [{name: "Authorization", value: "Bearer " ~ $access_token}, {name: "Accept", value: "application/vnd.github+json"}]
      params = {per_page: "100"}
    } as $gh_res

    var $names {
      value = $gh_res.response.result|map:$$.name
    }
  }

  response = {branches: $names}
}
