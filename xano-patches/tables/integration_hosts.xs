table "integration_hosts" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    text slug filters=trim {
      description = "Host slug (github, microsoft, google, ...)"
    }

    text name filters=trim {
      description = "Display name"
    }

    text website_url? filters=trim {
      description = "Host website URL"
    }

    image logo? {
      description = "Brand logo"
    }

    image logo_dark? {
      description = "Dark mode logo"
    }

    text brand_color? filters=trim {
      description = "Fallback badge color"
    }

    text initials? filters=trim {
      description = "Fallback initials"
    }

    int sort_order?=0 {
      description = "Marketplace sort order"
    }

    timestamp created_at?=now {
      description = "Created at"
    }

    timestamp updated_at?=now {
      description = "Updated at"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree|unique", field: [{name: "slug", op: "asc"}]}
  ]
}
