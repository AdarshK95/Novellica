"""
Create a Windows desktop shortcut for Novellica Control Panel.
Run once: .venv_tts\\Scripts\\python.exe create_shortcut.py
"""
import os
import sys

def create_shortcut():
    try:
        import win32com.client
    except ImportError:
        print("pywin32 is required. Install: pip install pywin32")
        sys.exit(1)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    shortcut_path = os.path.join(desktop, "Novellica.lnk")

    # Use pythonw.exe so no console window appears
    pythonw = os.path.join(base_dir, ".venv_tts", "Scripts", "pythonw.exe")
    script = os.path.join(base_dir, "control_panel.py")
    ico = os.path.join(base_dir, "novellica.ico")

    shell = win32com.client.Dispatch("WScript.Shell")
    shortcut = shell.CreateShortCut(shortcut_path)
    shortcut.Targetpath = pythonw
    shortcut.Arguments = f'"{script}"'
    shortcut.WorkingDirectory = base_dir
    shortcut.Description = "Novellica — AI Story Writing Studio"

    if os.path.exists(ico):
        shortcut.IconLocation = ico

    shortcut.save()
    print(f"✓ Shortcut created: {shortcut_path}")
    print(f"  Target: {pythonw}")
    print(f"  Script: {script}")
    if os.path.exists(ico):
        print(f"  Icon:   {ico}")
    else:
        print(f"  ⚠ Icon not found at {ico} — run generate_icon first.")

if __name__ == "__main__":
    create_shortcut()
