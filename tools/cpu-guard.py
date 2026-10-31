#!/usr/bin/env python3
"""cpu-guard: Shane's CPU rules for Flight Sim's dev commands, a count cap and a time cap.

Run every command that can keep a CPU core busy for more than about a minute through it:
bake scripts, test suites, headless sim runs, browser checks and benchmarks.

    python3 games/flight-sim/tools/cpu-guard.py -- /tmp/flight-sim/venv/bin/python games/flight-sim/tools/bake_terrain.py
    python3 games/flight-sim/tools/cpu-guard.py --minutes 5 -- node --test games/flight-sim/tests/*.test.mjs

What it enforces:
  * Count cap. At most SLOTS guarded commands run at once on this machine, across every agent
    and subagent. A command waits for a free slot, up to --wait minutes (default 30).
  * Time cap. A command is stopped, together with every process it started, after --minutes of
    wall-clock time (the default is also the maximum, MAX_MINUTES). Each process also gets a
    CPU-time limit of minutes x threads. Longer jobs must be split into resumable pieces, not
    given more time.
  * Memory cap. A command is stopped, with everything it started, once its process group holds
    more than --mem-gb of resident memory in total (the default is also the maximum, MAX_MEM_GB;
    checked every second). macOS ignores memory rlimits, so the guard measures with ps instead.
    Big data must be streamed or processed in tiles, not loaded whole. Scripts can read
    FLIGHT_SIM_MEM_GB to size their chunks.
  * Threads. OpenMP, BLAS, Accelerate, numexpr and libuv pools are capped at --threads (the
    default is also the maximum, MAX_THREADS). Scripts can read FLIGHT_SIM_THREADS to size
    their own worker pools.
  * Nothing left behind. When the command ends, anything still running in its process group
    is stopped too. Servers and browsers that should keep running don't belong under the guard.

Other modes:
    --status   the slots in use and the end of the log (/tmp/flight-sim/cpu.log)
    --sweep    processes above 50% CPU for more than 5 minutes (report only; exits 1 if any)

Exit status: the command's own; 123 when the memory cap stopped it; 124 when the time cap
stopped it; 125 when no slot came free; 128 + N when the command or the guard died from signal N.

Standard library only, and Python 3.9 compatible (the version macOS ships).
"""
import argparse
import json
import os
import resource
import signal
import subprocess
import sys
import time

SLOTS = 2            # heavy commands at once, machine-wide
MAX_MINUTES = 20.0   # wall-clock cap per command
MAX_MEM_GB = 6.0     # resident-memory cap per command (its whole process group); Shane's Mac has 24 GB
MAX_THREADS = 2      # thread-pool cap per command
POLL_S = 1.0         # how often the memory cap is checked

STATE = os.environ.get("FLIGHT_SIM_CPU_DIR", "/tmp/flight-sim")
SLOT_DIR = os.path.join(STATE, "cpu-slots")
LOG = os.path.join(STATE, "cpu.log")
THREAD_VARS = (
    "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS",
    "NUMEXPR_NUM_THREADS", "NUMEXPR_MAX_THREADS", "RAYON_NUM_THREADS", "UV_THREADPOOL_SIZE",
    "FLIGHT_SIM_THREADS",
)


class Interrupted(Exception):
    pass


def stamp():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def log(msg):
    os.makedirs(STATE, exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write("%s %s\n" % (stamp(), msg))


def alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def group_alive(pgid):
    if not isinstance(pgid, int) or pgid <= 0:
        return False
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def stop_group(pgid, grace=10.0, proc=None):
    """SIGTERM the whole process group, then SIGKILL whatever is still there after `grace` s."""
    if proc is not None:
        proc.poll()  # reap the leader if it has already exited, so it doesn't linger as a zombie
    if not group_alive(pgid):
        return False
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return True
    end = time.time() + grace
    while time.time() < end:
        if proc is not None:
            proc.poll()
        if not group_alive(pgid):
            return True
        time.sleep(0.2)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if proc is not None:
        proc.poll()
    return True


def _ps(fields):
    try:
        return subprocess.run(["ps", "-A", "-o", fields], capture_output=True, text=True,
                              timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def group_rss_kb(pgid):
    """Resident memory, in KB, of every process in the group (plus the leader's descendants)."""
    total = 0
    seen = set()
    for line in _ps("pid=,pgid=,rss=").splitlines():
        parts = line.split()
        if len(parts) == 3:
            try:
                pid, pg, rss = int(parts[0]), int(parts[1]), int(parts[2])
            except ValueError:
                continue
            if pg == pgid:
                total += rss
                seen.add(pid)
    # Also count descendants that moved to a process group of their own.
    kids = {}
    rss_of = {}
    for line in _ps("pid=,ppid=,rss=").splitlines():
        parts = line.split()
        if len(parts) == 3:
            try:
                pid, ppid, rss = int(parts[0]), int(parts[1]), int(parts[2])
            except ValueError:
                continue
            kids.setdefault(ppid, []).append(pid)
            rss_of[pid] = rss
    stack = [pgid]
    while stack:
        pid = stack.pop()
        for kid in kids.get(pid, []):
            if kid not in seen:
                seen.add(kid)
                total += rss_of.get(kid, 0)
            stack.append(kid)
    if pgid not in seen:
        total += rss_of.get(pgid, 0)
    return total


def slot_paths():
    return [os.path.join(SLOT_DIR, "slot%d" % i) for i in range(SLOTS)]


def read_owner(d):
    try:
        with open(os.path.join(d, "owner.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_owner(d, info):
    tmp = os.path.join(d, "owner.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(info, f)
    os.replace(tmp, os.path.join(d, "owner.json"))


def remove_slot(d):
    try:
        for name in os.listdir(d):
            try:
                os.unlink(os.path.join(d, name))
            except FileNotFoundError:
                pass
        os.rmdir(d)
    except OSError:
        pass


def reclaim_if_stale(d):
    """Free a slot whose guard died without cleaning up, and stop the group it left running."""
    owner = read_owner(d)
    if owner is None:
        try:
            if time.time() - os.path.getmtime(d) < 10:
                return  # another guard is creating it right now
        except OSError:
            return
    elif alive(owner.get("guard")):
        return
    else:
        pgid = owner.get("pgid")
        if group_alive(pgid):
            stop_group(pgid, grace=2.0)
        log("reclaimed %s: its guard (pid %s) is gone; stopped group %s: %s"
            % (os.path.basename(d), owner.get("guard"), pgid, owner.get("label", "?")))
    remove_slot(d)


def acquire(label, wait_s):
    os.makedirs(SLOT_DIR, exist_ok=True)
    deadline = time.time() + wait_s
    told = False
    while True:
        for d in slot_paths():
            try:
                os.mkdir(d)
            except FileExistsError:
                reclaim_if_stale(d)
                continue
            write_owner(d, {"guard": os.getpid(), "pgid": None, "pid": None, "label": label,
                            "start": stamp(), "t0": time.time()})
            return d
        if time.time() >= deadline:
            return None
        if not told:
            sys.stderr.write("cpu-guard: all %d slots are busy; waiting up to %.0f min\n"
                             % (SLOTS, wait_s / 60.0))
            told = True
        time.sleep(2.0)


def status():
    print("cpu-guard: %d slot(s), time cap %g min, memory cap %g GB, %d thread(s) per command"
          % (SLOTS, MAX_MINUTES, MAX_MEM_GB, MAX_THREADS))
    busy = 0
    if os.path.isdir(SLOT_DIR):
        for name in sorted(os.listdir(SLOT_DIR)):
            owner = read_owner(os.path.join(SLOT_DIR, name))
            busy += 1
            if owner is None:
                print("  %s: starting, or stale" % name)
                continue
            state = "running" if alive(owner.get("guard")) else "STALE (guard gone)"
            print("  %s: %s for %.0f s, pid %s: %s" % (
                name, state, time.time() - owner.get("t0", time.time()), owner.get("pid"),
                owner.get("label")))
    if not busy:
        print("  no slots in use")
    if os.path.exists(LOG):
        with open(LOG, encoding="utf-8") as f:
            tail = f.readlines()[-10:]
        print("last lines of %s:" % LOG)
        sys.stdout.write("".join("  " + line for line in tail))
    return 0


def parse_etime(text):
    """ps etime: [[dd-]hh:]mm:ss, in seconds."""
    days = 0
    if "-" in text:
        d, text = text.split("-", 1)
        days = int(d)
    parts = [int(p) for p in text.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, s = parts[-3:]
    return days * 86400 + h * 3600 + m * 60 + s


def sweep(min_cpu, min_minutes):
    out = subprocess.run(["ps", "-A", "-o", "pid=,pcpu=,etime=,command="],
                         capture_output=True, text=True).stdout
    me = os.getpid()
    hits = []
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        try:
            pid, cpu, elapsed = int(parts[0]), float(parts[1]), parse_etime(parts[2])
        except ValueError:
            continue
        if pid != me and cpu >= min_cpu and elapsed >= min_minutes * 60:
            hits.append((cpu, pid, elapsed, parts[3]))
    if not hits:
        print("cpu-guard sweep: nothing above %g%% CPU for more than %g min" % (min_cpu, min_minutes))
        return 0
    print("cpu-guard sweep: above %g%% CPU for more than %g min (stop only what you started):"
          % (min_cpu, min_minutes))
    for cpu, pid, elapsed, cmd in sorted(hits, reverse=True):
        print("  pid %-7d %5.1f%%  %6.1f min  %s" % (pid, cpu, elapsed / 60.0, cmd[:160]))
    return 1


def run(cmd, minutes, threads, mem_gb, wait_min, label):
    minutes = max(0.01, min(minutes, MAX_MINUTES))
    threads = max(1, min(threads, MAX_THREADS))
    mem_gb = max(0.05, min(mem_gb, MAX_MEM_GB))
    mem_cap_kb = int(mem_gb * 1024 * 1024)
    wall = minutes * 60.0
    cpu_limit = int(max(1, round(wall * threads)))
    label = label or " ".join(cmd)[:160]

    def on_signal(signum, frame):
        raise Interrupted(signum)

    for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(s, on_signal)

    def limit_cpu():
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit + 10))
        except (ValueError, OSError):
            pass

    slot = None
    proc = None
    rc = 0
    peak_kb = 0
    t0 = time.time()
    try:
        slot = acquire(label, wait_min * 60.0)
        if slot is None:
            sys.stderr.write("cpu-guard: no slot came free; not running: %s\n" % label)
            log("gave up waiting for a slot: %s" % label)
            return 125
        env = dict(os.environ)
        for name in THREAD_VARS:
            env[name] = str(threads)
        env["FLIGHT_SIM_CPU_GUARD"] = "1"
        env["FLIGHT_SIM_MEM_GB"] = "%g" % mem_gb
        proc = subprocess.Popen(cmd, env=env, start_new_session=True, preexec_fn=limit_cpu)
        owner = read_owner(slot) or {}
        owner.update({"pgid": proc.pid, "pid": proc.pid})
        write_owner(slot, owner)
        log("start %s pid %d, caps %g min / %g GB, %d thread(s): %s"
            % (os.path.basename(slot), proc.pid, minutes, mem_gb, threads, label))
        deadline = time.time() + wall
        capped = False
        while True:
            try:
                rc = proc.wait(timeout=POLL_S)
                break
            except subprocess.TimeoutExpired:
                pass
            if time.time() >= deadline:
                sys.stderr.write("cpu-guard: the %g min time cap is up; stopping: %s\n" % (minutes, label))
                stop_group(proc.pid, proc=proc)
                proc.wait()
                rc, capped = 124, True
                log("TIME CAP %s after %.0f s: %s" % (os.path.basename(slot), time.time() - t0, label))
                break
            used_kb = group_rss_kb(proc.pid)
            peak_kb = max(peak_kb, used_kb)
            if used_kb > mem_cap_kb:
                sys.stderr.write("cpu-guard: the %g GB memory cap is passed (%.1f GB in use); stopping: %s\n"
                                 % (mem_gb, used_kb / 1048576.0, label))
                stop_group(proc.pid, grace=3.0, proc=proc)
                proc.wait()
                rc, capped = 123, True
                log("MEMORY CAP %s at %.1f GB after %.0f s: %s"
                    % (os.path.basename(slot), used_kb / 1048576.0, time.time() - t0, label))
                break
        if not capped:
            if rc < 0:
                if -rc == getattr(signal, "SIGXCPU", -1):
                    sys.stderr.write("cpu-guard: the CPU-time cap (%d s) stopped: %s\n" % (cpu_limit, label))
                    log("CPU CAP %s after %.0f s: %s" % (os.path.basename(slot), time.time() - t0, label))
                rc = 128 - rc
    except Interrupted as e:
        rc = 128 + e.args[0]
        log("guard interrupted by signal %d: %s" % (e.args[0], label))
    finally:
        if proc is not None:
            if stop_group(proc.pid, grace=3.0, proc=proc):
                log("stopped what was left in group %d: %s" % (proc.pid, label))
            if proc.poll() is None:
                proc.wait()
        if slot:
            remove_slot(slot)
        if proc is not None:
            log("end rc %d after %.0f s, peak %.2f GB: %s"
                % (rc, time.time() - t0, peak_kb / 1048576.0, label))
    return rc


def main():
    argv = sys.argv[1:]
    if "--" in argv:
        i = argv.index("--")
        opts, cmd = argv[:i], argv[i + 1:]
    else:
        opts, cmd = argv, []
    ap = argparse.ArgumentParser(
        prog="cpu-guard.py",
        description="Run a CPU-heavy command under Flight Sim's count cap and time cap.",
        usage="%(prog)s [--minutes M] [--mem-gb G] [--threads N] [--wait M] [--label TEXT] -- command ...\n"
              "       %(prog)s --status | --sweep")
    ap.add_argument("--minutes", type=float, default=MAX_MINUTES,
                    help="wall-clock cap, at most %g (default)" % MAX_MINUTES)
    ap.add_argument("--mem-gb", type=float, default=MAX_MEM_GB,
                    help="memory cap for the whole command, at most %g (default)" % MAX_MEM_GB)
    ap.add_argument("--threads", type=int, default=MAX_THREADS,
                    help="thread-pool cap, at most %d (default)" % MAX_THREADS)
    ap.add_argument("--wait", type=float, default=30.0, help="minutes to wait for a free slot (30)")
    ap.add_argument("--label", help="name for the log (default: the command)")
    ap.add_argument("--status", action="store_true", help="show slots in use and the log's end")
    ap.add_argument("--sweep", action="store_true", help="list processes hogging the CPU")
    ap.add_argument("--sweep-cpu", type=float, default=50.0, help="sweep threshold in %% (50)")
    ap.add_argument("--sweep-minutes", type=float, default=5.0, help="sweep threshold in min (5)")
    args = ap.parse_args(opts)
    if args.status:
        return status()
    if args.sweep:
        return sweep(args.sweep_cpu, args.sweep_minutes)
    if not cmd:
        ap.error("give the command after --")
    return run(cmd, args.minutes, args.threads, args.mem_gb, args.wait, args.label)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:  # e.g. `--status | head`
        sys.exit(0)
