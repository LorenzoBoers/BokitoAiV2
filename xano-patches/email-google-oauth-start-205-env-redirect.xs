query "email/google/oauth/start" verb=GET {
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
  
    precondition (($env.GOOGLE_CLIENT_ID|to_text|strlen) > 0) {
      error_type = "inputerror"
      error = "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID in Xano environment variables."
    }
  
    precondition (($env.GOOGLE_REDIRECT_URI|to_text|strlen) > 0) {
      error_type = "inputerror"
      error = "Gmail OAuth is not configured. Set GOOGLE_REDIRECT_URI (must match Google Cloud Console redirect URI for this Xano host exactly)."
    }
  
    var $default_return_url {
      value = $env.dashboard_google_return_url|to_text
    }
  
    conditional {
      if (($default_return_url|strlen) == 0) {
        var.update $default_return_url {
          value = $env.dashboard_outlook_return_url|to_text
        }
      }
    }
  
    conditional {
      if (($default_return_url|strlen) == 0) {
        var.update $default_return_url {
          value = "https://app.bokito.ai/settings/inbox"
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
        feature        : "gmail-email"
      }
    } as $state_row
  
    var $scope {
      value = "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"
    }
  
    var $client_id_enc {
      value = $env.GOOGLE_CLIENT_ID|to_text|url_encode_rfc3986
    }
  
    var $redirect_enc {
      value = $env.GOOGLE_REDIRECT_URI|to_text|url_encode_rfc3986
    }
  
    var $scope_enc {
      value = $scope|url_encode_rfc3986
    }
  
    var $state_enc {
      value = $nonce|to_text|url_encode_rfc3986
    }
  
    var $authorize_url {
      value = "https://accounts.google.com/o/oauth2/v2/auth?client_id=" ~ $client_id_enc ~ "&redirect_uri=" ~ $redirect_enc ~ "&response_type=code&scope=" ~ $scope_enc ~ "&access_type=offline&include_granted_scopes=true&prompt=consent&state=" ~ $state_enc
    }
  }

  response = {authorize_url: $authorize_url}
}