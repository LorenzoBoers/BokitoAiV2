// GET /api:integrations/integrations/mcp/oauth/start - remote MCP OAuth (delegates PKCE to runtime)
query "integrations/mcp/oauth/start" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
    text provider filters=trim
    text return_url? filters=trim
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
      where = $db.integration_providers.slug == $input.provider && $db.integration_providers.auth_type == "mcp_remote_oauth"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $prov_rows

    precondition (($prov_rows|count) > 0) {
      error_type = "inputerror"
      error = "Unknown remote MCP provider."
    }

    var $provider {
      value = $prov_rows|first
    }

    precondition ($provider.mcp_remote_url != null && ($provider.mcp_remote_url|strlen) > 0) {
      error_type = "inputerror"
      error = "Provider MCP URL is not configured."
    }

    var $resolved_return_url {
      value = $input.return_url != null && ($input.return_url|strlen) > 0 ? $input.return_url : "https://app.bokito.ai/integrations/marketplace"
    }

    security.create_uuid as $state_id

    var $runtime_base {
      value = $env.RUNTIME_INTERNAL_URL|to_text
    }

    precondition (($runtime_base|strlen) > 0) {
      error_type = "inputerror"
      error = "RUNTIME_INTERNAL_URL is not configured."
    }

    api.request {
      url = $runtime_base ~ "/internal/mcp/oauth/start"
      method = "POST"
      params = {}
      headers = []
        |push:("Authorization: Bearer " ~ ($env.WORKER_INBOUND_SECRET|to_text))
        |push:"Content-Type: application/json"
        |push:"Accept: application/json"
      body = {
        state_id       : $state_id
        slug           : $provider.slug
        mcp_remote_url : $provider.mcp_remote_url
        mcp_transport  : $provider.mcp_transport
        oauth_config_key: $provider.oauth_config_key
        oauth_profile  : $provider.oauth_profile
      }
      timeout = 60
    } as $oauth_res

    var $oauth_body {
      value = $oauth_res.response.result
    }

    var $authorize_url {
      value = $oauth_body.authorize_url|to_text
    }

    var $code_verifier {
      value = $oauth_body.code_verifier|to_text
    }

    var $oauth_client_id {
      value = $oauth_body.oauth_client_id|to_text
    }

    precondition (($authorize_url|strlen) > 0 && ($code_verifier|strlen) > 0) {
      error_type = "inputerror"
      error = "MCP OAuth start failed. Check runtime logs and MCP_OAUTH_CALLBACK_URL."
    }

    db.add integration_oauth_states {
      data = {
        id              : $state_id
        provider_slug   : $input.provider
        tenant_id       : $me.organisation_id
        user_id         : $me.id
        return_url      : $resolved_return_url
        code_verifier   : $code_verifier
        oauth_client_id : $oauth_client_id
        mcp_remote_url  : $provider.mcp_remote_url
        oauth_profile   : $provider.oauth_profile
        expires_at      : now|add_secs_to_timestamp:900
      }
    } as $state_row
  }

  response = {
    authorize_url: $authorize_url
    provider     : $input.provider
    state        : $state_id
  }
}
