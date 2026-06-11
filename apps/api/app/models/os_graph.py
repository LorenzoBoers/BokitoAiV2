"""AI OS canvas overlay: node positions and edges on top of domain entities."""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

# Node types map to domain tables via ref_id.
OS_NODE_TYPES = frozenset({"orchestrator", "workstream", "repo", "tool"})

# Edge relations and allowed (source_type, target_type) pairs.
OS_EDGE_RELATIONS = frozenset({"routed_by", "uses_repo", "uses_tool"})

ALLOWED_EDGES: dict[str, tuple[str, str]] = {
    "routed_by": ("workstream", "orchestrator"),
    "uses_repo": ("workstream", "repo"),
    "uses_tool": ("workstream", "tool"),
}


class OsCanvasNode(SQLModel, table=True):
    __tablename__ = "os_canvas_nodes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    node_type: str = Field(index=True)
    ref_id: uuid.UUID = Field(index=True)
    x: float = 0.0
    y: float = 0.0
    label: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class OsCanvasEdge(SQLModel, table=True):
    __tablename__ = "os_canvas_edges"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    source_node_id: uuid.UUID = Field(foreign_key="os_canvas_nodes.id", index=True)
    target_node_id: uuid.UUID = Field(foreign_key="os_canvas_nodes.id", index=True)
    relation: str = Field(index=True)
    config_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
