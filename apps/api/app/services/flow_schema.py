"""Text schema for a flow: nodes, arrows, and what each arrow carries.

A line ``name: text`` opens a step. Indented lines belong to the step above,
or to the arrow above. ``from -> to: when`` is an arrow. An indented ``geeft:``
under that arrow names what it carries. ``stop`` is reserved: the work ends.
"""

from __future__ import annotations

import re
from typing import Any

NODE_FIELDS = ("wie", "tools", "geeft", "krijgt", "faalt", "stil", "max", "stand", "plek")
EDGE_FIELDS = ("geeft", "faalt", "stil")
WIE = {"", "agent", "user", "beide"}
STAND = {"", "manual", "assisted", "autonomous"}
_MAX_RE = re.compile(r"^\d+\s*(m|u|d|werkdagen)$")
_PLEK_RE = re.compile(r"^-?\d+\s*,\s*-?\d+$")
_EDGE_RE = re.compile(r"^(.+?)\s*->\s*(.+?)\s*:\s*(.*)$")
_NODE_RE = re.compile(r"^([^:]+):\s*(.*)$")
_FIELD_RE = re.compile(r"^([A-Za-z]+):\s*(.*)$")
STOP = "stop"


def empty_node(name: str, text: str = "") -> dict[str, str]:
    row = {"name": name.strip(), "text": text.strip()}
    for key in NODE_FIELDS:
        row[key] = ""
    return row


def empty_edge(src: str, dst: str, when: str = "") -> dict[str, str]:
    row = {"src": src.strip(), "dst": dst.strip(), "when": when.strip()}
    for key in EDGE_FIELDS:
        row[key] = ""
    return row


def parse_schema(source: str) -> dict[str, Any]:
    """Parse the notation. ``errors`` is empty when the text is a valid schema."""
    nodes: list[dict[str, str]] = []
    edges: list[dict[str, str]] = []
    errors: list[dict[str, Any]] = []
    current: tuple[str, int] | None = None
    seen: dict[str, int] = {}

    for line_no, raw in enumerate(source.splitlines(), 1):
        if not raw.strip():
            continue
        if raw[0] in " \t":
            if current is None:
                errors.append({"line": line_no, "message": "Indented line has no step or arrow above it"})
                continue
            match = _FIELD_RE.match(raw.strip())
            if match is None or match.group(1) not in NODE_FIELDS:
                errors.append({"line": line_no, "message": "Unknown field on this step or arrow"})
                continue
            key, value = match.group(1), match.group(2).strip()
            kind, index = current
            if kind == "edge" and key not in EDGE_FIELDS:
                errors.append({"line": line_no, "message": "An arrow carries geeft, faalt or stil"})
                continue
            (edges if kind == "edge" else nodes)[index][key] = value
            continue

        text = raw.strip()
        edge = _EDGE_RE.match(text)
        if edge is not None:
            row = empty_edge(edge.group(1), edge.group(2), edge.group(3))
            if not row["src"] or not row["dst"]:
                errors.append({"line": line_no, "message": "An arrow needs a source and a target"})
            edges.append(row)
            current = ("edge", len(edges) - 1)
            continue

        node = _NODE_RE.match(text)
        if node is None:
            errors.append({"line": line_no, "message": "Expected a step (name: text) or an arrow (from -> to: when)"})
            current = None
            continue
        name = node.group(1).strip()
        if not name or "->" in name:
            errors.append({"line": line_no, "message": "A step name cannot contain an arrow"})
            current = None
            continue
        if name == STOP:
            errors.append({"line": line_no, "message": "stop is reserved and is not a step"})
            current = None
            continue
        if name in seen:
            errors.append({"line": line_no, "message": f"Step {name} is already defined"})
        seen[name] = line_no
        nodes.append(empty_node(name, node.group(2)))
        current = ("node", len(nodes) - 1)

    names = {node["name"] for node in nodes}
    for node in nodes:
        if node["wie"] not in WIE:
            errors.append({"line": 0, "message": f"{node['name']}: wie is agent, user or beide"})
        if node["stand"] not in STAND:
            errors.append({"line": 0, "message": f"{node['name']}: stand is manual, assisted or autonomous"})
        if node["max"] and _MAX_RE.match(node["max"]) is None:
            errors.append({"line": 0, "message": f"{node['name']}: max uses 30m, 4u, 2d or 2 werkdagen"})
        if node["plek"] and _PLEK_RE.match(node["plek"]) is None:
            errors.append({"line": 0, "message": f"{node['name']}: plek is column,row, for example 2,-1"})
    for edge in edges:
        if edge["src"] not in names:
            errors.append({"line": 0, "message": f"Arrow leaves unknown step {edge['src']}"})
        if edge["dst"] != STOP and edge["dst"] not in names:
            errors.append({"line": 0, "message": f"Arrow enters unknown step {edge['dst']}"})
    return {"nodes": nodes, "edges": edges, "errors": errors}


def render_schema(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> str:
    """Write the notation back. Empty fields stay off the page."""
    lines: list[str] = []
    for node in nodes:
        name = str(node.get("name") or "").strip()
        if not name or name == STOP:
            continue
        lines.append(f"{name}: {str(node.get('text') or '').strip()}".rstrip())
        for key in NODE_FIELDS:
            value = str(node.get(key) or "").strip()
            if value:
                lines.append(f"  {key}: {value}")
        lines.append("")
    for edge in edges:
        src = str(edge.get("src") or "").strip()
        dst = str(edge.get("dst") or "").strip()
        if not src or not dst:
            continue
        lines.append(f"{src} -> {dst}: {str(edge.get('when') or '').strip()}".rstrip())
        for key in EDGE_FIELDS:
            value = str(edge.get(key) or "").strip()
            if value:
                lines.append(f"  {key}: {value}")
    return "\n".join(lines).strip() + ("\n" if lines else "")


def derive_from_stages(stages: list[dict[str, Any]]) -> dict[str, Any]:
    """A straight line through the current columns, until someone draws arrows."""
    nodes = [empty_node(str(stage.get("key") or ""), str(stage.get("name") or "")) for stage in stages if stage.get("key")]
    edges = [
        empty_edge(nodes[index]["name"], nodes[index + 1]["name"])
        for index in range(len(nodes) - 1)
    ]
    return {"nodes": nodes, "edges": edges, "errors": []}


def graph_for(source: str, stages: list[dict[str, Any]]) -> dict[str, Any]:
    """The stored notation, or the straight line of the current columns."""
    if not (source or "").strip():
        graph = derive_from_stages(stages)
        graph["source"] = render_schema(graph["nodes"], graph["edges"])
        return graph
    graph = parse_schema(source)
    graph["source"] = source if graph["errors"] else render_schema(graph["nodes"], graph["edges"])
    return graph


def display_nodes(graph: dict[str, Any]) -> list[dict[str, str]]:
    """Steps plus a stop card when an arrow ends the work."""
    nodes = [dict(node) for node in graph.get("nodes") or []]
    if any(edge.get("dst") == STOP for edge in graph.get("edges") or []) and not any(
        node.get("name") == STOP for node in nodes
    ):
        nodes.append(empty_node(STOP, ""))
    return nodes
