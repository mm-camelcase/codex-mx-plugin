"""Launcher: never parses hook input; execs the observer under a fixed OS policy."""
import os
import sys
import subprocess

def profile(destination):
    # Destination is derived from the OS uid, never hook data or environment.
    return '(version 1)(allow default)(deny file-write*)(deny network*)(allow network-outbound (literal "' + destination + '"))'

def main():
    if sys.platform != 'darwin':
        return
    destination = '/private/tmp/codex-keypad-' + str(os.getuid()) + '/events.sock'
    worker = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'worker.py')
    subprocess.run(['/usr/bin/sandbox-exec', '-p', profile(destination), '/usr/bin/python3', '-I', '-B', worker, destination],
                   env={'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8'}, stdin=sys.stdin,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=0.8)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        pass
    sys.stdout.write('{}')
