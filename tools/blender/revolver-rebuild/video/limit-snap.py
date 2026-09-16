"""Apply the agreed caps to this Blender process's own snap scope before loading source."""
from pathlib import Path
import subprocess
cg=next(s[3:] for s in Path('/proc/self/cgroup').read_text().splitlines() if s.startswith('0::'))
unit=cg.rsplit('/',1)[-1]
if not unit.startswith('snap.blender.blender-') or not unit.endswith('.scope'):
    raise RuntimeError('Refuse to alter any scope except this process own Blender snap scope')
subprocess.run(['/usr/bin/systemctl','--user','set-property',unit,'MemoryMax=1800M','MemoryHigh=1600M','TasksMax=192','CPUQuota=200%'],check=True)
if (Path('/sys/fs/cgroup'+cg)/'memory.max').read_text().strip()!='1887436800':raise RuntimeError('Blender memory cap was not applied')
print('VIDEO_CAP',unit,'MemoryMax1800M MemoryHigh1600M Tasks192 CPU200%',flush=True)
