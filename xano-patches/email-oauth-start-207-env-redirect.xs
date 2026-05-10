query "email/oauth/start" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
    text provider filters=trim|lower
    text return_url? filters=trim
  }

  stack {
    precondition ($input.provider == "outlook" || $input.provider == "gmail") {
      error_type = "inputerror"
      error = "Unsupported provider. Use outlook or gmail."
    }
  
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
  
    var $feature_val {
      value = "gmail-email"
    }
  
    conditional {
      if ($input.provider == "outlook") {
        var.update $feature_val {
          value = "outlook-email"
        }
      }
    }
  
    var $default_return_url {
      value = $env.dashboard_outlook_return_url|to_text
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
        feature        : $feature_val
      }
    } as $state_row
  
    var $authorize_url {
      value = ""
    }
  
    var $google_redirect_uri {
      value = $env.GOOGLE_REDIRECT_URI|to_text
    }
  
    var $microsoft_redirect_uri {
      value = $env.MICROSOFT_REDIRECT_URI|to_text
    }
  
    conditional {
      if ($input.provider == "outlook") {
        precondition (($env.MICROSOFT_CLIENT_ID|to_text|strlen) > 0) {
          error_type = "inputerror"
          error = "Outlook OAuth is not configured."
        }
      
        precondition (($env.MICROSOFT_REDIRECT_URI|to_text|strlen) > 0) {
          error_type = "inputerror"
          error = "Outlook OAuth is not configured: set MICROSOFT_REDIRECT_URI."
        }
      
        var $scope {
          value = "offline_access openid profile email User.Read Mail.Read Mail.Send"
        }
      
        var.update $authorize_url {
          value = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=" ~ ($env.MICROSOFT_CLIENT_ID|to_text|url_encode_rfc3986) ~ "&response_type=code&redirect_uri=" ~ ($microsoft_redirect_uri|url_encode_rfc3986) ~ "&response_mode=query&scope=" ~ ($scope|url_encode_rfc3986) ~ "&prompt=consent&state=" ~ ($nonce|to_text|url_encode_rfc3986)
        }
      }
    
      else {
        precondition (($env.GOOGLE_CLIENT_ID|to_text|strlen) > 0) {
          error_type = "inputerror"
          error = "Gmail OAuth is not configured."
        }
      
        precondition (($env.GOOGLE_REDIRECT_URI|to_text|strlen) > 0) {
          error_type = "inputerror"
          error = "Gmail OAuth is not configured: set GOOGLE_REDIRECT_URI."
        }
      
        var $scope {
          value = "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"
        }
      
        var.update $authorize_url {
          value = "https://accounts.google.com/o/oauth2/v2/auth?client_id=" ~ ($env.GOOGLE_CLIENT_ID|to_text|url_encode_rfc3986) ~ "&redirect_uri=" ~ ($google_redirect_uri|url_encode_rfc3986) ~ "&response_type=code&scope=" ~ ($scope|url_encode_rfc3986) ~ "&access_type=offline&include_granted_scopes=true&prompt=consent&state=" ~ ($nonce|to_text|url_encode_rfc3986)
        }
      }
    }
  }

  response = {authorize_url: $authorize_url}
}
