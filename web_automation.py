import asyncio
import os
from playwright.async_api import async_playwright, Page, BrowserContext

import subprocess

# Path for the persistent browser profile
USER_DATA_DIR = os.path.join(os.getcwd(), ".gemini_profile")

_playwright = None
_browser = None
_page: Page = None
_is_initializing = False

async def get_or_create_page() -> Page:
    global _playwright, _browser, _page, _is_initializing

    if _page and not _page.is_closed():
        return _page

    if _is_initializing:
        # Wait a bit if it's currently initializing
        while _is_initializing:
            await asyncio.sleep(0.5)
        if _page and not _page.is_closed():
            return _page

    _is_initializing = True
    try:
        print("[WebAutomation] Cleaning up orphaned Chrome processes...")
        if os.name == 'nt':
            try:
                subprocess.run(
                    ["powershell", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome.exe' -and $_.CommandLine -match 'gemini_profile' } | Invoke-CimMethod -MethodName Terminate"],
                    capture_output=True, timeout=5
                )
            except:
                pass

        if not _playwright:
            _playwright = await async_playwright().start()

        # Find Chrome path
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
            raise Exception("Chrome not found on this system.")

        print("[WebAutomation] Launching real Chrome process natively...")
        # Launch Chrome via subprocess to completely bypass Playwright's launch constraints
        subprocess.Popen([
            chrome_path,
            f"--user-data-dir={USER_DATA_DIR}",
            "--remote-debugging-port=9222",
            "--no-first-run",
            "--no-default-browser-check",
            "https://gemini.google.com/app"
        ])

        # Wait for the browser to start and open the debugging port
        print("[WebAutomation] Connecting Playwright to Chrome via CDP...")

        max_retries = 10
        for i in range(max_retries):
            try:
                # Use 127.0.0.1 instead of localhost to prevent IPv6 (::1) ECONNREFUSED errors
                _browser = await _playwright.chromium.connect_over_cdp("http://127.0.0.1:9222")
                break
            except Exception as e:
                if i == max_retries - 1:
                    raise Exception(f"Failed to connect to Chrome CDP after {max_retries} retries: {str(e)}")
                print(f"[WebAutomation] CDP not ready yet, retrying ({i+1}/{max_retries})...")
                await asyncio.sleep(1.5)

        context = _browser.contexts[0]
        pages = context.pages
        if pages:
            _page = pages[0]
        else:
            _page = await context.new_page()

        print("[WebAutomation] Browser ready.")
        return _page
    finally:
        _is_initializing = False

async def stream_gemini_response(prompt: str):
    """
    Sends a prompt to Gemini and streams the response back.
    Yields chunks of text.
    """
    page = await get_or_create_page()

    # Target the rich text editor
    # Gemini uses a contenteditable div inside a complex structure
    editor_selector = "div[contenteditable='true'][role='textbox']"

    print(f"[WebAutomation] Waiting for textbox...")
    try:
        await page.wait_for_selector(editor_selector, timeout=10000)
    except Exception as e:
        yield f"Error: Could not find the chat input box. Are you logged in? Please check the browser window.\n"
        return

    print(f"[WebAutomation] Typing prompt...")
    # Fill the prompt
    await page.fill(editor_selector, "") # Clear first

    # We use evaluate to set the text content to handle newlines easily
    await page.evaluate(f"""(selector, text) => {{
        const el = document.querySelector(selector);
        el.innerText = text;
        // Trigger input event to enable the send button
        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
    }}""", editor_selector, prompt)

    # Press Enter to send
    # Note: Sometimes Gemini requires Ctrl+Enter or a button click.
    # Let's try pressing Enter. If it has newlines, maybe we need to click the send button.
    # The send button usually has aria-label="Send message" or similar.
    send_btn_selector = "button[aria-label*='Send']"

    await asyncio.sleep(0.5) # Small delay to let React update state

    try:
        # Check if the send button is available and click it
        send_btn = await page.wait_for_selector(send_btn_selector, timeout=2000, state="visible")
        if send_btn:
            await send_btn.click()
            print("[WebAutomation] Clicked Send button.")
        else:
            await page.keyboard.press("Enter")
            print("[WebAutomation] Pressed Enter.")
    except:
        # Fallback to Enter
        await page.keyboard.press("Enter")
        print("[WebAutomation] Pressed Enter (fallback).")

    print("[WebAutomation] Waiting for response to start streaming...")

    # Wait for the response container to appear
    # Gemini usually creates a new response stream containing 'message-content'
    # We'll monitor the DOM for new text.

    # Wait a moment for the user message to disappear from input
    await asyncio.sleep(2.0)

    # Find all response blocks, the last one is ours
    response_selector = "message-content"

    try:
        # Wait for at least one message-content to be visible
        await page.wait_for_selector(response_selector, timeout=30000)
    except Exception:
        yield "Error: Timed out waiting for Gemini to respond."
        return

    # Now we stream the text
    # We poll the last message-content element and yield the diff
    last_text = ""
    is_done = False
    timeout_counter = 0
    max_idle_polls = 60 # 60 * 0.5s = 30s idle timeout

    while not is_done:
        await asyncio.sleep(0.5)

        # Get the text of the LAST message-content
        current_text = await page.evaluate(f"""(selector) => {{
            const nodes = document.querySelectorAll(selector);
            if (nodes.length === 0) return "";
            return nodes[nodes.length - 1].innerText;
        }}""", response_selector)

        if current_text != last_text:
            # Found new text
            new_chunk = current_text[len(last_text):]
            yield new_chunk
            last_text = current_text
            timeout_counter = 0
        else:
            timeout_counter += 1

        # Check if generation is complete.
        # Gemini usually hides the "Generating..." indicator or shows specific buttons when done.
        # We can also check if the text hasn't changed for a while (e.g. 5 seconds).
        if timeout_counter >= 10: # 5 seconds of no new text
            is_done = True

    print("[WebAutomation] Streaming complete.")
