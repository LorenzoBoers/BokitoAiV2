"""Integration modules: capability contracts on the Integration lane.

A module is a stable agent-facing contract (fixed verbs, canonical objects)
with one or more vendor adapters underneath. Agents never see vendor
endpoints or vendor tool names; adapters declare capabilities and impossible
calls return a structured ``unsupported`` response.
"""
