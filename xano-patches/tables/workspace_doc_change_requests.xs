table "workspace_doc_change_requests" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    uuid tenant_id {
      description = "Organisation (tenant)"
    }

    uuid workspace_doc_id {
      table = "workspace_docs"
      description = "Workspace doc"
    }

    uuid target_page_id? {
      description = "Page the change targets"
    }

    text title? filters=trim {
      description = "Optional short title"
    }

    text body filters=trim {
      description = "Change request body"
    }

    enum status? {
      values = ["pending", "in_progress", "implemented", "blocked", "rejected"]
      description = "Request status"
    }

    int priority?=5 {
      description = "Priority 1-10"
    }

    enum submitted_by_type? {
      values = ["user", "agent"]
    }

    text submitted_by_id? {
      description = "Submitter id"
    }

    int[] linked_revision_ids? {
      description = "Revision ids linked to fulfillment"
    }

    timestamp resolved_at? {
      description = "When resolved"
    }

    timestamp created_at?=now {
      description = "When the request was created"
    }

    timestamp updated_at?=now {
      description = "Last update"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [
        {name: "workspace_doc_id", op: "asc"}
        {name: "status", op: "asc"}
        {name: "created_at", op: "desc"}
      ]
    }
  ]
}
