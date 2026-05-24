// GET /api:integrations/integrations/providers - marketplace catalog with host logos
query "integrations/providers" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
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
      sort = {integration_providers.sort_order: "asc"}
      return = {type: "list"}
    } as $providers

    db.query integration_hosts {
      sort = {integration_hosts.sort_order: "asc"}
      return = {type: "list"}
    } as $hosts

    db.query integration_connections {
      where = $db.integration_connections.tenant_id == $me.organisation_id && $db.integration_connections.status == "active"
      return = {type: "list"}
    } as $connections

    var $conn_counts {
      value = {}
    }

    foreach ($connections) {
      each as $c {
        var $pid {
          value = $c.provider_id|to_text
        }

        var $prev {
          value = $conn_counts[$pid]|to_int
        }

        var.update $conn_counts {
          value = $conn_counts|set:$pid:($prev + 1)
        }
      }
    }

    var $email_outlook_count {
      value = 0
    }

    var $email_gmail_count {
      value = 0
    }

    db.query email_oauth_connection {
      where = $db.email_oauth_connection.organisation_id == $me.organisation_id && $db.email_oauth_connection.status == "active"
      return = {type: "list"}
    } as $email_rows

    foreach ($email_rows) {
      each as $e {
        conditional {
          if ($e.provider == "gmail") {
            var.update $email_gmail_count {
              value = $email_gmail_count + 1
            }
          }

          else {
            var.update $email_outlook_count {
              value = $email_outlook_count + 1
            }
          }
        }
      }
    }

    var $hosts_public {
      value = []
    }

    foreach ($hosts) {
      each as $h {
        var $logo_url {
          value = null
        }

        var $logo_dark_url {
          value = null
        }

        conditional {
          if ($h.logo != null) {
            var.update $logo_url {
              value = $h.logo|get:"url":null
            }
          }
        }

        conditional {
          if ($h.logo_dark != null) {
            var.update $logo_dark_url {
              value = $h.logo_dark|get:"url":null
            }
          }
        }

        var $host_item {
          value = {
            id           : $h.id
            slug         : $h.slug
            name         : $h.name
            website_url  : $h.website_url
            logo_url     : $logo_url
            logo_dark_url: $logo_dark_url
            brand_color  : $h.brand_color
            initials     : $h.initials
          }
        }

        var.update $hosts_public {
          value = $hosts_public|push:$host_item
        }
      }
    }

    var $providers_public {
      value = []
    }

    foreach ($providers) {
      each as $p {
        var $host_embed {
          value = null
        }

        conditional {
          if ($p.host_id != null) {
            foreach ($hosts_public) {
              each as $hp {
                conditional {
                  if ($hp.id == $p.host_id) {
                    var.update $host_embed {
                      value = $hp|pick: ["slug", "name", "website_url", "logo_url", "logo_dark_url", "brand_color", "initials"]
                    }
                  }
                }
              }
            }
          }
        }

        var $provider_item {
          value = $p|set:"host":$host_embed
        }

        var.update $providers_public {
          value = $providers_public|push:$provider_item
        }
      }
    }
  }

  response = {
    providers        : $providers_public
    hosts            : $hosts_public
    connection_counts: {
      by_provider_id: $conn_counts
      email_outlook : $email_outlook_count
      email_gmail   : $email_gmail_count
    }
  }
}
