// POST /api:workforce/index/chunks - worker body auth, upsert chunk with embedding
query "index/chunks" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key
    uuid project_id?
    uuid workspace_doc_id?
    uuid tenant_id
    uuid connection_id?
    text source_type
    text source_ref
    text content
    json embedding
  }

  stack {
    precondition ($input.worker_api_key == $env.XANO_WORKER_API_KEY) {
      error_type = "accessdenied"
      error = "Unauthorized worker."
    }

    precondition ($input.project_id != null || $input.workspace_doc_id != null) {
      error_type = "inputerror"
      error = "Either project_id or workspace_doc_id is required."
    }

    conditional {
      if ($input.project_id != null) {
        db.query index_chunks {
          where = $db.index_chunks.project_id == $input.project_id && $db.index_chunks.source_ref == $input.source_ref
          return = {type: "list"}
        } as $existing_rows
      }

      else {
        db.query index_chunks {
          where = $db.index_chunks.tenant_id == $input.tenant_id && $db.index_chunks.workspace_doc_id == $input.workspace_doc_id && $db.index_chunks.source_ref == $input.source_ref
          return = {type: "list"}
        } as $existing_rows
      }
    }

    conditional {
      if (($existing_rows|count) > 0) {
        var $existing {
          value = $existing_rows|first
        }

        db.edit index_chunks {
          field_name = "id"
          field_value = $existing.id
          data = {
            content   : $input.content
            embedding : $input.embedding
            updated_at: now
          }
        } as $chunk
      }

      else {
        db.add index_chunks {
          data = {
            project_id       : $input.project_id
            workspace_doc_id : $input.workspace_doc_id
            tenant_id        : $input.tenant_id
            connection_id    : $input.connection_id
            source_type      : $input.source_type
            source_ref       : $input.source_ref
            content          : $input.content
            embedding        : $input.embedding
            created_at       : now
            updated_at       : now
          }
        } as $chunk
      }
    }
  }

  response = {ok: true, chunk_id: $chunk.id}
}
