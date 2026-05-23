#!/usr/bin/env python3
import os
import paramiko

KEY = os.path.expanduser("~/.ssh/bokito_vps_deploy")
RUN_CONFIG = (
    '{"run_id":"debug","project_id":"7baa7578-2119-40a5-bdde-b1bb3e2ef27d",'
    '"tenant_id":"067ebc22-6aac-4986-868b-857bc1c55f5f","work_log_id":"debug",'
    '"agent":{"id":"96312783-18b2-4484-a31b-60b815f69740","name":"PO","role":"po",'
    '"model":"claude-sonnet-4","system_prompt":"Reply with one short sentence.",'
    '"max_loops":1,"tools":[]},'
    '"task":{"thread_id":"debug","subject":"Say hello","body":""},'
    '"report_to":{"type":"user","id":""},'
    '"budget":{"remaining_today":1000,"remaining_hour":1000},'
    '"xano":{"base_url":"https://xrex-nmji-j9ur.f2.xano.io",'
    '"work_log_url":"https://xrex-nmji-j9ur.f2.xano.io/api:workforce/work_logs/debug/events",'
    '"messages_url":"https://xrex-nmji-j9ur.f2.xano.io/api:workforce/messages/worker",'
    '"search_index_url":"https://xrex-nmji-j9ur.f2.xano.io/api:workforce/index/search",'
    '"pkb_url":"https://xrex-nmji-j9ur.f2.xano.io/api:workforce/pkb"}}'
)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("31.97.45.44", username="root", key_filename=KEY, timeout=30)
remote = f"""
set -a
source /root/bokito-runtime/.env
set +a
docker run --rm --add-host=host.docker.internal:host-gateway \\
  -e ANTHROPIC_API_KEY \\
  -e 'RUN_CONFIG_JSON={RUN_CONFIG}' \\
  -e XANO_RUN_TOKEN=debug \\
  bokito-agent-run:latest
"""
_, stdout, stderr = client.exec_command(remote, timeout=180)
out = stdout.read().decode()
err = stderr.read().decode()
code = stdout.channel.recv_exit_status()
print(out[-3000:])
if err:
    print("STDERR", err[-1000:])
print("exit", code)
client.close()
