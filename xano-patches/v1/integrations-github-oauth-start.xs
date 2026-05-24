// GET /api:integrations/github/oauth/start - begin GitHub OAuth for tenant
query "github/oauth/start" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
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

    var $resolved_return_url {
      value = $input.return_url != null && ($input.return_url|strlen) > 0 ? $input.return_url : "https://app.bokito.ai/projects"
    }

    security.create_uuid as $state_id

    db.add github_oauth_states {
      data = {
        id             : $state_id
        tenant_id      : $me.organisation_id
        user_id        : $me.id
        return_url     : $resolved_return_url
        project_id     : $input.project_id
        expires_at     : now|add_secs_to_timestamp:900
      }
    } as $state_row

    var $client_id {
      value = $env.GITHUB_OAUTH_CLIENT_ID|to_text
    }

    precondition (($client_id|strlen) > 0) {
      error_type = "inputerror"
      error = "GitHub OAuth is not configured."
    }

    var $authorize_url {
      value = "https://github.com/login/oauth/authorize?client_id=" ~ $client_id ~ "&scope=read:user%20repo&state=" ~ $state_id ~ "&redirect_uri=" ~ ($env.GITHUB_OAUTH_CALLBACK_URL|url_encode)
    }
  }

  response = {authorize_url: $authorize_url}
}
