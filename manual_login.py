import os
import subprocess
import sys

# Path to the special profile we use for automation
profile_dir = os.path.join(os.getcwd(), ".gemini_profile")

# Find Chrome on Windows
paths = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")
]

chrome_path = None
for p in paths:
    if os.path.exists(p):
        chrome_path = p
        break

if not chrome_path:
    print("Could not find Chrome installed on this system.")
    sys.exit(1)

print(f"Launching normal Chrome using profile: {profile_dir}")
print("Please log in to Google, then close the browser entirely.")

subprocess.Popen([
    chrome_path,
    f"--user-data-dir={profile_dir}",
    "https://gemini.google.com/app"
])
