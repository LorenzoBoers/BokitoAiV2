"""Empty-tree helpers.

Dashboard bodies are typed blocks (``canvas_blocks``). This module remains so
older imports of the empty tree keep working. There is no JSX compiler.
"""

from app.services.canvas_blocks import EMPTY_TREE, is_empty_tree

EMPTY_SOURCE = ""

__all__ = ["EMPTY_SOURCE", "EMPTY_TREE", "is_empty_tree"]
