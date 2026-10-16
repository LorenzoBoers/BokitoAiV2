from uuid import uuid4

from app.models.signal import Signal

s = Signal(assignee_kind="user", assignee_id=uuid4())
assert s.assigned_user_id == s.assignee_id, (s.assigned_user_id, s.assignee_id)
assert s.assignee_team_id is None
tid = uuid4()
s.assignee_team_id = tid
assert s.assignee_kind == "team"
assert s.assignee_id == tid
assert s.assigned_user_id is None
s.active_turn_json = '{"nonce":"n1","streak":2}'
assert "active_turn" in s.floor_json
assert "n1" in s.active_turn_json
s.handoff_session_json = '{"id":"h1"}'
assert "handoff_session" in s.floor_json
uid = uuid4()
s.last_human_owner_user_id = uid
assert s.last_human_owner_kind == "user"
assert s.last_human_owner_user_id == uid
s.turn_user_id = uid
assert s.turn_kind == "user"
assert s.turn_ref_id == uid
print("compat attrs ok")
