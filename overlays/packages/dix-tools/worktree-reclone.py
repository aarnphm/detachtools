#!@python3@
"""Turn existing worktrees into copy-on-write clones of the project checkout.

usage: w-reclone <projects-dir> [<project> [<worktree>]]

A file is replaced only when the worktree and the project checkout hold the
same blob for it, git sees neither copy as modified, and neither changed while
the clone was made. The clone keeps the worktree file's mode and mtime, so the
worktree index stays valid under core.checkStat=minimal.
"""
import ctypes, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

GIT = "@git@"
FICLONE = 0x40049409
libc = ctypes.CDLL(None, use_errno=True)

def git(cwd, *args, check=True):
  return subprocess.run([GIT, "-C", cwd, *args], capture_output=True, check=check).stdout

def blobs(cwd):
  "Stage-0 regular files in the index: path -> (mode, blob)."
  res = {}
  for e in git(cwd, "ls-files", "-s", "-z").split(b"\0"):
    if not e: continue
    meta, p = e.split(b"\t", 1)
    mode, blob, stage = meta.split(b" ")
    if stage == b"0" and mode in (b"100644", b"100755"): res[p] = (mode, blob)
  return res

def modified(cwd):
  "Paths whose file differs from the index, after a normal stat refresh."
  git(cwd, "update-index", "-q", "--refresh", check=False)
  return {p for p in git(cwd, "diff-files", "--name-only", "-z").split(b"\0") if p}

def clone(src, dst):
  if sys.platform == "darwin":
    if libc.clonefile(src, dst, 0) != 0:
      err = ctypes.get_errno()
      raise OSError(err, os.strerror(err), dst)
    return
  import fcntl
  with open(src, "rb") as s, open(dst, "xb") as d: fcntl.ioctl(d.fileno(), FICLONE, s.fileno())

def same(a, b): return (a.st_ino, a.st_size, a.st_mtime_ns) == (b.st_ino, b.st_size, b.st_mtime_ns)

def reclone_file(donor, wt, p, cutoff, since):
  "Returns bytes now shared, 0 when skipped."
  src, dst = os.path.join(donor, p), os.path.join(wt, p)
  try: sd, sw = os.lstat(src), os.lstat(dst)
  except FileNotFoundError: return 0
  if not (os.path.isfile(src) and os.path.isfile(dst)) or os.path.islink(dst): return 0
  if sd.st_size != sw.st_size or sw.st_size == 0: return 0
  # Edited after git looked; already a clone from `w` (cp -p keeps the donor's
  # mtime) or from an earlier reclone (keeps its own mtime, older than `since`).
  if max(sd.st_mtime, sw.st_mtime) >= cutoff or sd.st_mtime_ns == sw.st_mtime_ns: return 0
  if sw.st_mtime < since: return 0
  head, base = os.path.split(dst)
  tmp = os.path.join(head, b".%s.w-reclone.%d" % (base, os.getpid()))
  try:
    clone(src, tmp)
    os.chmod(tmp, sw.st_mode & 0o7777)
    os.utime(tmp, ns=(sw.st_atime_ns, sw.st_mtime_ns))
    if not (same(os.lstat(src), sd) and same(os.lstat(dst), sw)): return 0
    os.rename(tmp, dst)
    return sw.st_size
  finally:
    if os.path.lexists(tmp): os.unlink(tmp)

def reclone(donor, wt):
  cutoff = time.time() - 1
  dmod, wmod = modified(donor), modified(wt)
  db, wb = blobs(donor), blobs(wt)
  paths = [p for p, v in wb.items() if db.get(p) == v and p not in dmod and p not in wmod]
  if os.stat(donor).st_dev != os.stat(wt).st_dev:
    print(f"  {wt}: different filesystem, skipped")
    return
  since = float(git(wt, "config", "--get", "w.reclonedAt", check=False).strip() or 0)
  donor_b, wt_b = os.fsencode(donor), os.fsencode(wt)
  shared = fails = n = 0
  with ThreadPoolExecutor(16) as ex:
    futs = [ex.submit(reclone_file, donor_b, wt_b, p, cutoff, since) for p in paths]
    for f in futs:
      try: b = f.result()
      except OSError: fails += 1; continue
      shared += b; n += b > 0
  git(donor, "config", "extensions.worktreeConfig", "true")
  git(wt, "config", "--worktree", "core.checkStat", "minimal")
  git(wt, "config", "--worktree", "core.trustctime", "false")
  git(wt, "config", "--worktree", "w.reclonedAt", f"{cutoff:.0f}")
  git(wt, "update-index", "-q", "--refresh", check=False)
  print(f"  {wt}: {n} files ({shared / 2**20:.0f} MiB) recloned, "
        f"{len(wb) - len(paths)} kept (edited or different blob), {fails} failed")

def worktrees(repo):
  "Linked worktrees of repo, minus the main checkout and prunable ones."
  res, cur = [], None
  for line in git(repo, "worktree", "list", "--porcelain", "-z").split(b"\0") + [b""]:
    if line.startswith(b"worktree "): cur = {"path": os.fsdecode(line[9:])}
    elif line == b"":
      if cur: res.append(cur)
      cur = None
    elif cur is not None: cur[os.fsdecode(line.split(b" ", 1)[0])] = True
  main = os.path.realpath(repo)
  return [w["path"] for w in res if "prunable" not in w and "bare" not in w
          and os.path.realpath(w["path"]) != main and os.path.isdir(w["path"])]

def main():
  if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"): sys.exit(__doc__)
  root = sys.argv[1]
  project, name = (sys.argv[2:4] + [None, None])[:2]
  projects = [project] if project else sorted(
    d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d, ".git")))
  before = os.statvfs(root)
  for proj in projects:
    repo = os.path.join(root, proj)
    wts = [w for w in worktrees(repo) if name is None or os.path.basename(w) == name]
    if not wts: continue
    print(f"[{proj}]")
    for wt in wts: reclone(repo, wt)
  after = os.statvfs(root)
  freed = (after.f_bavail - before.f_bavail) * after.f_frsize
  print(f"free space change: {freed / 2**20:+.0f} MiB "
        "(local Time Machine snapshots keep old blocks until they expire)")

if __name__ == "__main__": main()
