#!/usr/bin/env python3
import os
import paramiko

KEY = os.path.expanduser("~/.ssh/bokito_vps_deploy")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("31.97.45.44", username="root", key_filename=KEY, timeout=30)
cmd = (
    "docker run --rm --add-host=host.docker.internal:host-gateway "
    "-e RUN_CONFIG_JSON='{\"run_id\":\"test\",\"project_id\":\"p\",\"tenant_id\":\"t\",\"work_log_id\":\"w\","
    "\"agent\":{\"id\":\"a\",\"name\":\"PO\",\"role\":\"po\",\"model\":\"claude-sonnet-4\",\"system_prompt\":\"Say hi\","
    "\"max_loops\":1,\"tools\":[]},\"task\":{\"thread_id\":\"th\",\"subject\":\"Hi\",\"body\":\"\"},"
    "\"report_to\":{\"type\":\"user\",\"id\":\"\"},\"budget\":{\"remaining_today\":1000,\"remaining_hour\":1000},"
    "\"xano\":{\"base_url\":\"https://xrex-nmji-j9ur.f2.xano.io\",\"work_log_url\":\"https://example/events\","
    "\"messages_url\":\"https://example/messages\",\"search_index_url\":\"https://example/search\",\"pkb_url\":\"https://example/pkb\"}}' "
    "$(grep ANTHROPIC_API_KEY= /root/bokito-runtime/.env | sed 's/^/ -e /') "
    "-e XANO_RUN_TOKEN=test bokito-agent-run:latest 2>&1 | tail -30"
)
_, stdout, stderr = client.exec_command(f"bash -lc {repr(cmd)}", timeout=120)
print(stdout.read().decode())
print(stderr.read().decode())
client.close()
