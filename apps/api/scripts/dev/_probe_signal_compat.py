from uuid import uuid4

from app.models.signal import Signal

uid = uuid4()
s = Signal(tenant_id=uuid4(), assigned_user_id=uid)
assert s.assignee_kind == "user" and s.assignee_id == uid and s.assigned_user_id == uid

s2 = Signal(tenant_id=uuid4())
s2.assigned_user_id = uid
assert s2.assignee_kind == "user" and s2.assignee_id == uid

tid = uuid4()
s2.assignee_team_id = tid
assert s2.assignee_kind == "team" and s2.assignee_team_id == tid and s2.assigned_user_id is None

s2.active_turn_json = '{"agent_id":"x","claimed_at":"t"}'
assert "active_turn" in s2.floor_json
assert "agent_id" in s2.active_turn_json

s3 = Signal(tenant_id=uuid4(), turn_user_id=uid, last_human_owner_kind="user", last_human_owner_user_id=uid)
assert s3.turn_kind == "user" and s3.turn_ref_id == uid
assert s3.last_human_owner_kind == "user" and s3.last_human_owner_user_id == uid
print("ok")
