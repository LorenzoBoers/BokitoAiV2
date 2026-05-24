// POST /api:integrations/integrations/connections - API key connection (e.g. Bjorn Lunden)
query "integrations/connections" verb=POST {
  api_group = "integrations"
  auth = "user"

  input {
    text provider filters=trim
    text api_key filters=trim
    text display_name? filters=trim
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

    precondition (($input.api_key|strlen) > 0) {
      error_type = "inputerror"
      error = "api_key is required."
    }

    db.query integration_providers {
      where = $db.integration_providers.slug == $input.provider && $db.integration_providers.auth_type == "api_key"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $prov_rows

    precondition (($prov_rows|count) > 0) {
      error_type = "inputerror"
      error = "Unknown API key provider."
    }

    var $provider {
      value = $prov_rows|first
    }

    var $label {
      value = $input.display_name != null && ($input.display_name|strlen) > 0 ? $input.display_name : $provider.name
    }

    security.create_uuid as $conn_id

    var $external_id {
      value = $conn_id|to_text
    }

    db.add integration_connections {
      data = {
        id                  : $conn_id
        tenant_id           : $me.organisation_id
        provider_id         : $provider.id
        external_account_id : $external_id
        display_name        : $label
        credentials         : {api_key: $input.api_key}
        status              : "active"
        connected_by_user_id: $me.id
        metadata            : {}
        created_at          : now
        updated_at          : now
      }
    } as $conn
  }

  response = $conn|pick: ["id", "tenant_id", "provider_id", "external_account_id", "display_name", "status", "created_at"]
}
