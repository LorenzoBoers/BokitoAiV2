// GET /api:integrations/integrations/oauth/start - generic OAuth (github supported)
query "integrations/oauth/start" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
    text provider filters=trim
    text return_url? filters=trim
    uuid project_id?
  }

  stack {
    db.get user {
      field_name = "id"
      field_value = $auth.id|to_int
    } as $me

    precondition ($me != null && $me.organisation_id != null) {
      error_type = "accessdenied"
      error = "Account context required."
    }

    db.query integration_providers {
      where = $db.integration_providers.slug == $input.provider && $db.integration_providers.auth_type == "oauth2"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $prov_rows

    precondition (($prov_rows|count) > 0) {
      error_type = "inputerror"
      error = "Unknown OAuth provider."
    }

    var $resolved_return_url {
      value = $input.return_url != null && ($input.return_url|strlen) > 0 ? $input.return_url : "https://app.bokito.ai/integrations/marketplace"
    }

    security.create_uuid as $state_id

    db.add integration_oauth_states {
      data = {
        id            : $state_id
        provider_slug : $input.provider
        tenant_id     : $me.organisation_id
        user_id       : $me.id
        return_url    : $resolved_return_url
        project_id    : $input.project_id
        expires_at    : now|add_secs_to_timestamp:900
      }
    } as $state_row

    db.add github_oauth_states {
      data = {
        id         : $state_id
        tenant_id  : $me.organisation_id
        user_id    : $me.id
        return_url : $resolved_return_url
        project_id : $input.project_id
        expires_at : now|add_secs_to_timestamp:900
      }
    } as $legacy_state

    var $authorize_url {
      value = ""
    }

    conditional {
      if ($input.provider == "github") {
        var $client_id {
          value = $env.GITHUB_OAUTH_CLIENT_ID|to_text
        }

        precondition (($client_id|strlen) > 0) {
          error_type = "inputerror"
          error = "GitHub OAuth is not configured."
        }

        var.update $authorize_url {
          value = "https://github.com/login/oauth/authorize?client_id=" ~ $client_id ~ "&scope=read:user%20repo&state=" ~ $state_id ~ "&redirect_uri=" ~ ($env.GITHUB_OAUTH_CALLBACK_URL|url_encode)
        }
      }

      else {
        // Add new oauth2 providers here (or use dedicated /{provider}/oauth/start like GitHub).
        precondition (false) {
          error_type = "inputerror"
          error = "OAuth start not implemented for this provider."
        }
      }
    }
  }

  response = {authorize_url: $authorize_url, provider: $input.provider}
}
