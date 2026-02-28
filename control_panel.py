"""
Novellica Control Panel — Desktop Server Manager
Standalone Tkinter app that manages the Novellica (uvicorn) server process.
"""
import tkinter as tk
from tkinter import scrolledtext, ttk, messagebox
import subprocess
import threading
import queue
import sys
import webbrowser
import os
import time
import socket
import signal
import json

try:
    import psutil
except ImportError:
    print("psutil is required. Install: pip install psutil")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VENV_PYTHON = os.path.join(BASE_DIR, ".venv_tts", "Scripts", "python.exe")
SERVER_SCRIPT = os.path.join(BASE_DIR, "server.py")
PID_FILE = os.path.join(BASE_DIR, ".novellica.pid")
SERVER_PORT = 5000
SERVER_URL = f"http://localhost:{SERVER_PORT}"
STARTUP_TIMEOUT = 30  # seconds
HEALTH_INTERVAL = 2000  # ms
SINGLE_INSTANCE_PORT = 59123  # arbitrary high port for app lock


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def is_pid_alive(pid: int) -> bool:
    """Check if a process with this PID exists and is a Python process."""
    try:
        proc = psutil.Process(pid)
        return proc.is_running() and "python" in proc.name().lower()
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return False


def is_port_in_use(port: int) -> bool:
    """Check if a TCP port is listening."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def http_health_check(url: str, timeout: float = 2.0) -> bool:
    """Return True if we get an HTTP 200 from the URL."""
    import urllib.request
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def write_pid(pid: int):
    with open(PID_FILE, "w") as f:
        json.dump({"pid": pid}, f)


def read_pid() -> int | None:
    try:
        with open(PID_FILE, "r") as f:
            data = json.load(f)
            return data.get("pid")
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return None


def remove_pid():
    try:
        os.remove(PID_FILE)
    except FileNotFoundError:
        pass


def find_port_owner(port: int) -> int | None:
    """Return PID of the process listening on the given port, or None."""
    for conn in psutil.net_connections(kind="tcp"):
        if conn.laddr.port == port and conn.status == psutil.CONN_LISTEN:
            return conn.pid
    return None


# ---------------------------------------------------------------------------
# Single-instance lock
# ---------------------------------------------------------------------------

_instance_lock_socket = None


def acquire_instance_lock() -> bool:
    """Bind a socket to prevent multiple control panel instances."""
    global _instance_lock_socket
    try:
        _instance_lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _instance_lock_socket.bind(("127.0.0.1", SINGLE_INSTANCE_PORT))
        _instance_lock_socket.listen(1)
        return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Server Manager
# ---------------------------------------------------------------------------

class ServerManager:
    """Manages the lifecycle of the Novellica server process."""

    def __init__(self, on_log, on_status_change):
        self.process: subprocess.Popen | None = None
        self._pid: int | None = None
        self._log = on_log          # callback(str)
        self._status = on_status_change  # callback(str)  running|stopped|starting|stopping|error
        self._log_queue: queue.Queue = queue.Queue()
        self._starting = False

        # On init: detect existing server
        self._detect_existing()

    # -- Detection ----------------------------------------------------------

    def _detect_existing(self):
        """Check if a server is already running from a previous session."""
        pid = read_pid()
        if pid and is_pid_alive(pid):
            # PID is valid, confirm with port check
            if is_port_in_use(SERVER_PORT):
                self._pid = pid
                self._log(f"Detected existing server (PID {pid}) on port {SERVER_PORT}.")
                self._status("running")
                return
            else:
                self._log(f"PID {pid} alive but port {SERVER_PORT} not open. Treating as stale.")

        # Stale PID cleanup
        if pid is not None:
            self._log(f"Cleaning up stale PID file (PID {pid}).")
            remove_pid()

        # Also check if something else is on the port
        if is_port_in_use(SERVER_PORT):
            owner = find_port_owner(SERVER_PORT)
            self._log(f"⚠ Port {SERVER_PORT} is in use by another process (PID {owner}). "
                       f"Start will fail until that process is stopped.")
            self._log_queue.put("__PORT_BLOCKED__")

        self._status("stopped")

    # -- Properties ---------------------------------------------------------

    @property
    def is_running(self) -> bool:
        if self._pid and is_pid_alive(self._pid):
            return True
        if self.process and self.process.poll() is None:
            return True
        return False

    # -- Start --------------------------------------------------------------

    def start(self):
        if self.is_running:
            self._log("Server is already running.")
            return

        if is_port_in_use(SERVER_PORT):
            owner = find_port_owner(SERVER_PORT)
            self._log(f"✗ Port {SERVER_PORT} is already in use (PID {owner}). Cannot start.")
            self._log_queue.put("__PORT_BLOCKED__")
            self._status("error")
            return

        self._starting = True
        self._status("starting")
        self._log("Starting Novellica server...")

        try:
            startupinfo = None
            if sys.platform == "win32":
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

            self.process = subprocess.Popen(
                [VENV_PYTHON, "-u", SERVER_SCRIPT],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                cwd=BASE_DIR,
                startupinfo=startupinfo,
            )
            self._pid = self.process.pid
            write_pid(self._pid)
            self._log(f"Process spawned (PID {self._pid}). Waiting for HTTP 200...")

            # Threaded log reader — prevents pipe deadlock
            threading.Thread(target=self._read_stdout, daemon=True).start()

            # Threaded startup confirmation
            threading.Thread(target=self._wait_for_ready, daemon=True).start()

        except FileNotFoundError:
            self._log(f"✗ Python executable not found: {VENV_PYTHON}")
            self._status("error")
            self._starting = False
        except PermissionError as e:
            self._log(f"✗ Permission error: {e}")
            self._status("error")
            self._starting = False
        except Exception as e:
            self._log(f"✗ Failed to start: {e}")
            self._status("error")
            self._starting = False

    def _read_stdout(self):
        """Daemon thread: read subprocess stdout line-by-line into the queue."""
        proc = self.process
        if not proc or not proc.stdout:
            return
        try:
            for line in iter(proc.stdout.readline, ""):
                if not line:
                    break
                self._log_queue.put(line.rstrip())
        except Exception:
            pass
        finally:
            try:
                proc.stdout.close()
            except Exception:
                pass

    def _wait_for_ready(self):
        """Daemon thread: poll for HTTP 200 up to STARTUP_TIMEOUT seconds."""
        deadline = time.time() + STARTUP_TIMEOUT
        while time.time() < deadline:
            # If process died, abort
            if self.process and self.process.poll() is not None:
                self._log_queue.put("✗ Server process exited before becoming ready.")
                self._starting = False
                return  # on_process_end will handle status

            if http_health_check(SERVER_URL):
                self._log_queue.put(f"✓ Server ready at {SERVER_URL}")
                self._starting = False
                # Signal main thread to update status + open browser
                self._log_queue.put("__READY__")
                return

            time.sleep(0.5)

        # Timeout
        self._log_queue.put(f"✗ Server did not respond within {STARTUP_TIMEOUT}s. Check logs.")
        self._starting = False
        self._log_queue.put("__TIMEOUT__")

    # -- Stop ---------------------------------------------------------------

    def stop(self):
        if not self.is_running:
            self._log("Server is not running.")
            return

        self._status("stopping")
        self._log("Stopping server...")

        pid = self._pid
        proc = self.process

        def _do_stop():
            try:
                if proc and proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                        self._log_queue.put("Server stopped gracefully.")
                    except subprocess.TimeoutExpired:
                        # Verify PID + name before force-killing
                        if pid and is_pid_alive(pid):
                            self._log_queue.put("Graceful stop timed out. Force killing...")
                            proc.kill()
                            proc.wait(timeout=3)
                        else:
                            self._log_queue.put("Process already exited.")
                elif pid and is_pid_alive(pid):
                    # Adopted process (detected from PID file, no Popen handle)
                    self._log_queue.put(f"Terminating adopted process PID {pid}...")
                    try:
                        p = psutil.Process(pid)
                        p.terminate()
                        p.wait(timeout=5)
                        self._log_queue.put("Adopted process stopped.")
                    except psutil.TimeoutExpired:
                        if is_pid_alive(pid):
                            psutil.Process(pid).kill()
                            self._log_queue.put("Adopted process force-killed.")
                    except Exception as e:
                        self._log_queue.put(f"Error stopping adopted process: {e}")
            except Exception as e:
                self._log_queue.put(f"Error during stop: {e}")
            finally:
                remove_pid()
                self._pid = None
                self.process = None
                self._log_queue.put("__STOPPED__")

        threading.Thread(target=_do_stop, daemon=True).start()

    # -- Restart ------------------------------------------------------------

    def restart(self):
        self._log("Restarting server...")

        def _do_restart():
            # Stop
            if self.is_running:
                self.stop()
                # Wait until actually stopped
                for _ in range(20):  # 10s max
                    if not self.is_running:
                        break
                    time.sleep(0.5)
            time.sleep(0.5)
            # Start (schedule on main thread)
            self._log_queue.put("__DO_START__")

        threading.Thread(target=_do_restart, daemon=True).start()

    # -- Health check (called from GUI timer) --------------------------------

    def health_check(self) -> str:
        """Return current status: running | stopped | starting | error."""
        if self._starting:
            return "starting"

        if self._pid and is_pid_alive(self._pid):
            return "running"

        # Process died externally
        if self._pid:
            remove_pid()
            self._pid = None
            self.process = None
            return "stopped"

        if self.process and self.process.poll() is not None:
            self.process = None
            return "stopped"

        return "stopped"

    # -- Kill port blocker --------------------------------------------------

    def _find_root_python_parent(self, pid: int) -> psutil.Process | None:
        """Walk up the process tree from pid to find the topmost python parent."""
        try:
            proc = psutil.Process(pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return None

        root = proc
        try:
            parent = proc.parent()
            while parent is not None:
                if "python" in parent.name().lower():
                    root = parent
                    parent = parent.parent()
                else:
                    break
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
        return root

    def _kill_process_tree(self, proc: psutil.Process):
        """Kill a process and all its children (entire tree)."""
        proc_name = proc.name()
        pid = proc.pid

        # Collect the whole family first
        children = []
        try:
            children = proc.children(recursive=True)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

        # Terminate parent first
        self._log(f"Terminating {proc_name} (PID {pid}) + {len(children)} child process(es)...")
        try:
            proc.terminate()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

        # Terminate all children
        for child in children:
            try:
                child.terminate()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        # Wait for graceful exit
        gone, alive = psutil.wait_procs([proc] + children, timeout=5)
        if gone:
            self._log(f"✓ {len(gone)} process(es) stopped gracefully.")

        # Force-kill anything still alive
        for p in alive:
            try:
                self._log(f"Force-killing {p.name()} (PID {p.pid})...")
                p.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        if alive:
            psutil.wait_procs(alive, timeout=3)

    def kill_port_blocker(self):
        """Kill the entire process tree occupying SERVER_PORT."""
        owner_pid = find_port_owner(SERVER_PORT)
        if not owner_pid:
            self._log("Port is already free.")
            self._log_queue.put("__PORT_FREE__")
            return

        try:
            # Walk up to the root python parent (handles uvicorn reload tree)
            root = self._find_root_python_parent(owner_pid)
            if root is None:
                self._log(f"PID {owner_pid} not found. Attempting direct kill via taskkill...")
                # Fallback: use Windows taskkill /T /F to kill entire tree by PID
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(owner_pid)],
                        capture_output=True, text=True, timeout=10
                    )
                    self._log(f"Sent taskkill for PID {owner_pid}.")
                except Exception as e:
                    self._log(f"taskkill failed: {e}")
            else:
                self._log(f"Found process tree root: {root.name()} (PID {root.pid})")
                self._kill_process_tree(root)

        except psutil.AccessDenied:
            self._log(f"✗ Access denied. Try running the Control Panel as Administrator.")
        except Exception as e:
            self._log(f"✗ Error killing blocker: {e}")

        # Verify port is free (retry a few times — OS may take a moment to release)
        for attempt in range(6):
            time.sleep(0.5)
            if not is_port_in_use(SERVER_PORT):
                self._log_queue.put("__PORT_FREE__")
                return

        # Still blocked — signal so UI can reset the button
        self._log("⚠ Port still in use. Try closing the terminal that started the server.")
        self._log_queue.put("__PORT_BLOCKED__")

    def refresh_state(self):
        """Re-detect server state from scratch. Called by the GUI refresh button."""
        self._log("Refreshing state...")
        # Check if our managed process is still alive
        if self._pid and not is_pid_alive(self._pid):
            self._log(f"Managed PID {self._pid} is gone. Cleaning up.")
            remove_pid()
            self._pid = None
            self.process = None

        # Re-run the full detection
        pid = read_pid()
        if pid and is_pid_alive(pid):
            if is_port_in_use(SERVER_PORT):
                self._pid = pid
                self._log(f"✓ Server running (PID {pid}) on port {SERVER_PORT}.")
                self._status("running")
                self._log_queue.put("__PORT_FREE__")  # hide kill button
                return

        if is_port_in_use(SERVER_PORT):
            owner = find_port_owner(SERVER_PORT)
            self._log(f"⚠ Port {SERVER_PORT} blocked by foreign process (PID {owner}).")
            self._log_queue.put("__PORT_BLOCKED__")
            self._status("stopped")
        else:
            self._log("✓ Port is free. Server is stopped.")
            self._log_queue.put("__PORT_FREE__")
            self._status("stopped")

    # -- Drain log queue (called from GUI timer) ----------------------------

    def drain_logs(self) -> list[str]:
        lines = []
        while not self._log_queue.empty():
            try:
                lines.append(self._log_queue.get_nowait())
            except queue.Empty:
                break
        return lines


# ---------------------------------------------------------------------------
# GUI Application
# ---------------------------------------------------------------------------

class ControlPanel(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("Novellica Control Panel")
        self.geometry("700x450")
        self.minsize(500, 300)
        self.configure(bg="#0f1420")

        # Try to set window icon
        ico_path = os.path.join(BASE_DIR, "novellica.ico")
        if os.path.exists(ico_path):
            try:
                self.iconbitmap(ico_path)
            except Exception:
                pass

        self._build_ui()

        # Server manager
        self.mgr = ServerManager(
            on_log=self._log,
            on_status_change=self._set_status,
        )

        # Start health monitor + log drain loop
        self._tick()

        # Graceful shutdown
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # -- UI -----------------------------------------------------------------

    def _build_ui(self):
        bg = "#0f1420"
        fg = "#e8edf5"
        muted = "#8b95a8"
        btn_bg = "#1c2438"
        btn_active = "#2a3550"
        accent = "#f0a050"
        text_bg = "#0a0e17"

        # Header
        header = tk.Frame(self, bg=bg)
        header.pack(fill=tk.X, padx=12, pady=(12, 6))

        self.status_dot = tk.Label(header, text="●", font=("Segoe UI", 16), bg=bg, fg="#5a6478")
        self.status_dot.pack(side=tk.LEFT)

        self.status_label = tk.Label(header, text="Detecting...", font=("Segoe UI", 12, "bold"),
                                     bg=bg, fg=muted)
        self.status_label.pack(side=tk.LEFT, padx=(6, 0))

        # Buttons
        btn_frame = tk.Frame(header, bg=bg)
        btn_frame.pack(side=tk.RIGHT)

        def mkbtn(parent, text, cmd, **kw):
            b = tk.Button(parent, text=text, command=cmd,
                          bg=btn_bg, fg=fg, activebackground=btn_active, activeforeground=fg,
                          relief=tk.FLAT, font=("Segoe UI", 10, "bold"),
                          padx=12, pady=4, cursor="hand2",
                          disabledforeground="#5a6478", **kw)
            b.pack(side=tk.LEFT, padx=4)
            return b

        self.btn_start = mkbtn(btn_frame, "▶ Start", self._cmd_start)
        self.btn_stop = mkbtn(btn_frame, "■ Stop", self._cmd_stop, state=tk.DISABLED)
        self.btn_restart = mkbtn(btn_frame, "⟳ Restart", self._cmd_restart, state=tk.DISABLED)
        self.btn_open = mkbtn(btn_frame, "🌐 Open", self._cmd_open)
        self.btn_refresh = mkbtn(btn_frame, "↻ Refresh", self._cmd_refresh)

        # Kill blocker button — hidden by default, shown dynamically
        self.btn_kill_blocker = tk.Button(
            btn_frame, text="☠ Kill Blocking Process", command=self._cmd_kill_blocker,
            bg="#3b1a1a", fg="#f87171", activebackground="#5a2020", activeforeground="#fca5a5",
            relief=tk.FLAT, font=("Segoe UI", 9, "bold"),
            padx=8, pady=4, cursor="hand2",
        )
        # Don't pack yet — shown/hidden dynamically

        # Log area
        log_frame = tk.Frame(self, bg=bg)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=(0, 12))

        log_title = tk.Label(log_frame, text="Server Logs", bg=bg, fg=muted, font=("Segoe UI", 9))
        log_title.pack(anchor="w", pady=(0, 2))

        self.log_area = scrolledtext.ScrolledText(
            log_frame, bg=text_bg, fg="#a3a3a3", font=("Consolas", 10),
            relief=tk.FLAT, bd=0,
            highlightbackground="#1c2438", highlightcolor=accent, highlightthickness=1,
            wrap=tk.WORD,
        )
        self.log_area.pack(fill=tk.BOTH, expand=True)
        self.log_area.config(state=tk.DISABLED)

    # -- Logging ------------------------------------------------------------

    def _log(self, msg: str):
        self.log_area.config(state=tk.NORMAL)
        self.log_area.insert(tk.END, msg + "\n")
        self.log_area.see(tk.END)
        self.log_area.config(state=tk.DISABLED)

    # -- Status display -----------------------------------------------------

    STATUS_COLORS = {
        "running":  ("#4ade80", "Running"),
        "stopped":  ("#5a6478", "Stopped"),
        "starting": ("#fbbf24", "Starting..."),
        "stopping": ("#fbbf24", "Stopping..."),
        "error":    ("#f87171", "Error"),
    }

    def _set_status(self, status: str):
        color, label = self.STATUS_COLORS.get(status, ("#5a6478", status))
        self.status_dot.config(fg=color)
        self.status_label.config(text=label, fg=color)
        self._update_buttons(status)

    def _update_buttons(self, status: str):
        if status == "running":
            self.btn_start.config(state=tk.DISABLED)
            self.btn_stop.config(state=tk.NORMAL)
            self.btn_restart.config(state=tk.NORMAL)
        elif status in ("stopped", "error"):
            self.btn_start.config(state=tk.NORMAL)
            self.btn_stop.config(state=tk.DISABLED)
            self.btn_restart.config(state=tk.DISABLED)
        else:  # starting / stopping
            self.btn_start.config(state=tk.DISABLED)
            self.btn_stop.config(state=tk.DISABLED)
            self.btn_restart.config(state=tk.DISABLED)

    # -- Button commands ----------------------------------------------------

    def _cmd_start(self):
        self.mgr.start()

    def _cmd_stop(self):
        self.mgr.stop()

    def _cmd_restart(self):
        self.mgr.restart()

    def _cmd_open(self):
        webbrowser.open(SERVER_URL)

    def _cmd_kill_blocker(self):
        self.btn_kill_blocker.config(state=tk.DISABLED, text="Killing...")
        threading.Thread(target=self.mgr.kill_port_blocker, daemon=True).start()

    def _cmd_refresh(self):
        self._hide_kill_button()
        threading.Thread(target=self.mgr.refresh_state, daemon=True).start()

    def _show_kill_button(self):
        owner_pid = find_port_owner(SERVER_PORT)
        if owner_pid:
            try:
                name = psutil.Process(owner_pid).name()
            except Exception:
                name = "unknown"
            self.btn_kill_blocker.config(
                text=f"☠ Kill {name} (PID {owner_pid})",
                state=tk.NORMAL,
            )
            self.btn_kill_blocker.pack(side=tk.LEFT, padx=4)
        else:
            self.btn_kill_blocker.pack_forget()

    def _hide_kill_button(self):
        self.btn_kill_blocker.pack_forget()

    # -- Main tick loop (health + log drain) --------------------------------

    def _tick(self):
        # Drain log queue
        for line in self.mgr.drain_logs():
            if line == "__READY__":
                self._set_status("running")
                self._hide_kill_button()
                self.after(300, lambda: webbrowser.open(SERVER_URL))
                continue
            if line == "__TIMEOUT__":
                self._set_status("error")
                continue
            if line == "__STOPPED__":
                self._set_status("stopped")
                continue
            if line == "__DO_START__":
                self.mgr.start()
                continue
            if line == "__PORT_BLOCKED__":
                self._show_kill_button()
                continue
            if line == "__PORT_FREE__":
                self._hide_kill_button()
                self._log("✓ Port is now free. You can start the server.")
                self._set_status("stopped")
                continue
            self._log(line)

        # Health check
        status = self.mgr.health_check()
        current_label = self.status_label.cget("text")
        expected_label = self.STATUS_COLORS.get(status, ("", ""))[1]
        if current_label != expected_label and current_label not in ("Starting...", "Stopping..."):
            self._set_status(status)

        self.after(HEALTH_INTERVAL, self._tick)

    # -- Window close -------------------------------------------------------

    def _on_close(self):
        if self.mgr.is_running:
            answer = messagebox.askyesnocancel(
                "Novellica",
                "Server is still running.\n\n"
                "Yes = Stop server and exit\n"
                "No = Leave server running, close panel\n"
                "Cancel = Don't close",
            )
            if answer is None:  # Cancel
                return
            if answer:  # Yes — stop and exit
                self.mgr.stop()
                # Wait a moment for stop to complete
                deadline = time.time() + 6
                while self.mgr.is_running and time.time() < deadline:
                    self.update()
                    time.sleep(0.2)

        self.destroy()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    # Single-instance guard
    if not acquire_instance_lock():
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(
            "Novellica Control Panel",
            "Another instance of the Control Panel is already running.",
        )
        root.destroy()
        sys.exit(1)

    app = ControlPanel()

    # Center on screen
    app.update_idletasks()
    w, h = app.winfo_width(), app.winfo_height()
    x = (app.winfo_screenwidth() - w) // 2
    y = (app.winfo_screenheight() - h) // 2
    app.geometry(f"{w}x{h}+{x}+{y}")

    app.mainloop()


if __name__ == "__main__":
    main()
