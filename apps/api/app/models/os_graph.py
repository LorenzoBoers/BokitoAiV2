"""Retired: os_canvas_nodes / os_canvas_edges dropped in Alembic 101.

Project canvases (``project_canvases``) remain the live graph surface.
HTTP ``/os/graph*`` returns 410 via ``services.os_graph.os_graph_retired_response``.
"""

# Kept for import compatibility with older docs / comments.
OS_NODE_TYPES = ()
OS_EDGE_RELATIONS = ()
ALLOWED_EDGES: dict[str, tuple[str, str]] = {}
