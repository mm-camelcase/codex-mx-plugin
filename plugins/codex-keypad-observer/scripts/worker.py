"""Bounded observer: writes only a sanitized event to its fixed Unix socket."""
import json
import os
import re
import signal
import socket
import stat
import sys
import time
import uuid

EVENTS = {'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt'}

def observe(destination):
    signal.signal(signal.SIGALRM, lambda *_: sys.exit(0))
    signal.setitimer(signal.ITIMER_REAL, 0.5)
    observed_at = int(time.time() * 1000)
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        return
    data = json.loads(raw)
    if not isinstance(data, dict) or data.get('hook_event_name') not in EVENTS:
        return
    for key in ('session_id', 'turn_id'):
        if not isinstance(data.get(key), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', data[key]):
            return
    parent = os.path.dirname(destination)
    info = os.lstat(parent)
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid() or os.path.realpath(parent) != parent:
        return
    info = os.lstat(destination)
    if not stat.S_ISSOCK(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
        return
    event = {'version': 1, 'sessionId': data['session_id'], 'turnId': data['turn_id'],
             'event': data['hook_event_name'], 'eventId': uuid.uuid4().hex, 'observedAt': observed_at}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(0.15)
        client.connect(destination)
        client.sendall(json.dumps(event).encode('utf8'))
        client.shutdown(socket.SHUT_WR)
        client.recv(2)  # Bounded acknowledgement; never interpreted as instructions.

if __name__ == '__main__':
    try:
        observe(sys.argv[1])
    except Exception:
        pass
    # An empty JSON object supplies no decision or model-visible context.
    sys.stdout.write('{}')
