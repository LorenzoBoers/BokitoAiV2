// Returns Microsoft authorize URL for Outlook OAuth (per Bokito account)
query "email/outlook/oauth/start" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
    text return_url? filters=trim
  }

  stack {
    var $user_id {
      value = $auth.id|to_int
    }
  
    db.get user {
      field_name = "id"
      field_value = $user_id
    } as $user
  
    precondition ($user != null && $user.organisation_id != null) {
      error_type = "accessdenied"
      error = "Account context required."
    }
  
    precondition (($env.MICROSOFT_CLIENT_ID|to_text|strlen) > 0) {
      error_type = "inputerror"
      error = "Outlook OAuth is not configured. Set Xano environment variables MICROSOFT_CLIENT_ID (Azure Application ID)."
    }
  
    precondition (($env.MICROSOFT_REDIRECT_URI|to_text|strlen) > 0) {
      error_type = "inputerror"
      error = "Outlook OAuth is not configured. Set Xano environment variable MICROSOFT_REDIRECT_URI (must match Azure Web redirect URI for this Xano host exactly)."
    }
  
    var $default_return_url {
      value = $env.dashboard_outlook_return_url|to_text
    }
  
    conditional {
      if (($default_return_url|strlen) == 0) {
        var.update $default_return_url {
          value = "https://app.bokito.ai/settings/support/general"
        }
      }
    }
  
    var $resolved_return_url {
      value = $default_return_url
    }
  
    conditional {
      if (($input.return_url|strlen) > 0) {
        var.update $resolved_return_url {
          value = $input.return_url
        }
      }
    }
  
    security.create_uuid as $nonce
    var $expires_at {
      value = now|add_secs_to_timestamp:900
    }
  
    db.add email_outlook_oauth_state {
      data = {
        organisation_id: $user.organisation_id
        nonce          : $nonce
        user_id        : $user.id
        expires_at     : $expires_at
        return_url     : $resolved_return_url
        feature        : "outlook-email"
      }
    } as $state_row
  
    var $scope {
      value = "offline_access openid profile email User.Read Mail.Read Mail.Send"
    }
  
    var $redirect_enc {
      value = $env.MICROSOFT_REDIRECT_URI|to_text|url_encode_rfc3986
    }
  
    var $scope_enc {
      value = $scope|url_encode_rfc3986
    }
  
    var $state_enc {
      value = $nonce|to_text|url_encode_rfc3986
    }
  
    var $prompt_enc {
      value = "consent"|url_encode_rfc3986
    }
  
    var $authorize_url {
      value = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=" ~ $env.MICROSOFT_CLIENT_ID ~ "&response_type=code&redirect_uri=" ~ $redirect_enc ~ "&response_mode=query&scope=" ~ $scope_enc ~ "&prompt=" ~ $prompt_enc ~ "&state=" ~ $state_enc
    }
  }

  response = {authorize_url: $authorize_url}
}