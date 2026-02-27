import os
import json
import re
import asyncio
import time
import random
from pathlib import Path
from pydantic import BaseModel

try:
    from notion_client import AsyncClient
    from notion2md.exporter.block import StringExporter
except ImportError:
    AsyncClient = None
    StringExporter = None

try:
    from notion_client import APIResponseError
except ImportError:
    APIResponseError = None


# =============================================================
# Global Rate Limiter for ALL Notion API calls
# =============================================================
# Notion allows ~3 requests/sec per integration. We enforce a conservative
# gap and a global cooldown to avoid the "Hard Penalty Box" (900s).

MIN_REQUEST_GAP = 0.6          # 600 ms → 1.6 req/s (50% safety margin)
MAX_RETRIES     = 6            # retries on 429
JITTER_MAX      = 0.1          # subtle jitter
MAX_RETRY_AFTER = 300          # cap wait at 5 mins even if Notion asks for more

_last_request_ts = 0.0         # timestamp of last API start
_global_cooldown_until = 0.0   # if hit 429, total block until this time
_rate_lock = asyncio.Lock()    # serialise access


async def _throttle():
    """Wait until global cooldown and MIN_REQUEST_GAP have elapsed."""
    global _last_request_ts, _global_cooldown_until
    async with _rate_lock:
        now = time.monotonic()

        # 1. Respect the "Penalty Box" if active
        if now < _global_cooldown_until:
            wait_cooldown = _global_cooldown_until - now
            await asyncio.sleep(wait_cooldown + random.uniform(0.1, 0.3))
            now = time.monotonic()

        # 2. Enforce the polite gap between requests
        elapsed = now - _last_request_ts
        if elapsed < MIN_REQUEST_GAP:
            wait_gap = MIN_REQUEST_GAP - elapsed + random.uniform(0, JITTER_MAX)
            await asyncio.sleep(wait_gap)

        _last_request_ts = time.monotonic()


def _get_retry_after(exc) -> float:
    """Extract Retry-After header from Notion error safely."""
    try:
        # Check both the .headers attribute and the raw body if needed
        headers = getattr(exc, 'headers', {}) or {}
        ra = headers.get('Retry-After') or headers.get('retry-after')
        if ra:
            return max(float(ra), 1.0)
    except:
        pass
    return 0.0


async def _notion_call_with_retry(coro_factory, *, on_rate_limit=None):
    """Execute Notion API call with global throttling, cooldowns, and retry."""
    global _global_cooldown_until

    for attempt in range(1, MAX_RETRIES + 1):
        await _throttle()
        try:
            return await coro_factory()
        except Exception as e:
            is_rate_limit = False
            retry_after = 0.0

            # 1. Type-safe 429 check for APIResponseError
            if APIResponseError and isinstance(e, APIResponseError):
                if e.status == 429:
                    is_rate_limit = True
                    retry_after = _get_retry_after(e)

            # 2. Backup check for generic "rate limit" string
            if not is_rate_limit:
                msg = str(e).lower()
                if "429" in msg or ("rate" in msg and "limit" in msg):
                    is_rate_limit = True

            if is_rate_limit and attempt < MAX_RETRIES:
                # Print raw headers for debugging if possible
                if hasattr(e, 'headers'):
                    print(f"[Notion/Debug] 429 Headers: {getattr(e, 'headers')}")

                # Calculate required sleep
                if retry_after > 0:
                    delay = min(retry_after, MAX_RETRY_AFTER) + random.uniform(0.1, 0.5)
                else:
                    # Exponential backoff: 2s, 4s, 8s, 16s...
                    delay = min(2.0 * (2 ** (attempt - 1)), 60) + random.uniform(0.5, 1.5)

                # CRITICAL: Update the Global Cooldown so NO other requests fire
                now = time.monotonic()
                async with _rate_lock:
                    _global_cooldown_until = max(_global_cooldown_until, now + delay)

                print(f"[Notion] Rate Limit Hit! Global Cooldown for {delay:.1f}s (header={retry_after})")

                if on_rate_limit:
                    await on_rate_limit(delay, attempt)

                # This specific task waits, but _throttle will now also block others
                await asyncio.sleep(delay)
                continue

            # If not a rate limit, or we gave up
            raise

    raise RuntimeError(f"Notion API failed after {MAX_RETRIES} retries.")


# =============================================================
# Notion Settings & State Management
# =============================================================

PROJECTS_DIR = Path(__file__).parent / "projects"

def get_notion_client(api_key: str = None):
    # Try passed key, then env var
    token = api_key or os.environ.get("NOTION_INTEGRATION_TOKEN")
    if not token or not AsyncClient:
        return None
    return AsyncClient(auth=token)

def get_notion_map_path(project_name: str) -> Path:
    p = PROJECTS_DIR / project_name / ".notion_map.json"
    return p

def load_notion_map(project_name: str) -> dict:
    p = get_notion_map_path(project_name)
    if not p.exists():
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def save_notion_map(project_name: str, mapping: dict):
    p = get_notion_map_path(project_name)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2)

def set_page_mapping(project_name: str, file_rel_path: str, page_id: str):
    """Map a local file (e.g. 'Drafts/Chap1.txt') to a Notion Page ID"""
    m = load_notion_map(project_name)
    if page_id is None:
        m.pop(file_rel_path, None)
    else:
        m[file_rel_path] = page_id
    save_notion_map(project_name, m)

def get_page_mapping(project_name: str, file_rel_path: str) -> str:
    m = load_notion_map(project_name)
    return m.get(file_rel_path)


# ---------------------------------------------------------
# Pulling (Notion -> Markdown)
# ---------------------------------------------------------

BLOCKS_PER_PAGE = 100          # Notion page_size for blocks.children.list


def blocks_to_markdown(blocks: list) -> str:
    """Convert a list of Notion block objects to plain Markdown."""
    lines = []
    for block in blocks:
        btype = block.get("type", "")
        data = block.get(btype, {})
        rich = data.get("rich_text", [])
        text = "".join(r.get("plain_text", "") for r in rich)

        if btype == "heading_1":
            lines.append(f"# {text}")
        elif btype == "heading_2":
            lines.append(f"## {text}")
        elif btype == "heading_3":
            lines.append(f"### {text}")
        elif btype == "bulleted_list_item":
            lines.append(f"- {text}")
        elif btype == "numbered_list_item":
            lines.append(f"1. {text}")
        elif btype == "to_do":
            checked = "x" if data.get("checked") else " "
            lines.append(f"- [{checked}] {text}")
        elif btype == "code":
            lang = data.get("language", "")
            lines.append(f"```{lang}\n{text}\n```")
        elif btype == "quote":
            lines.append(f"> {text}")
        elif btype == "divider":
            lines.append("---")
        elif btype == "paragraph":
            lines.append(text if text else "")
        # Skip unsupported types silently

    return "\n".join(lines)


async def pull_page_markdown_chunked(page_id: str, api_key: str = None,
                                      on_progress=None):
    """
    Download a Notion page in paginated chunks with:
      - Global rate limiting (≤2.5 req/s with jitter)
      - Retry-After header support on 429
      - Exponential backoff with jitter
      - Progress reporting via async callback

    Args:
        page_id:     The Notion page / block ID.
        api_key:     Integration token (falls back to env vars).
        on_progress: An async callback ``async fn(info: dict)`` called after
                     each chunk is fetched.  The dict contains:
                       chunk_index (int)
                       blocks_so_far (int)
                       has_more (bool)
                       markdown_chunk (str)
                       status (str) – 'chunk' | 'done' | 'rate_limited'
                       retry_after (float) – only on rate_limited
                       retry_num (int) – only on rate_limited

    Returns:
        Full markdown string of all blocks joined together.
    """
    if not AsyncClient:
        raise RuntimeError("Notion dependencies not installed. Please run: pip install notion-client")

    token = api_key or os.environ.get("NOTION_INTEGRATION_TOKEN") or os.environ.get("NOTION_TOKEN")
    if not token:
        raise ValueError("Notion Integration Token is not set.")

    notion = AsyncClient(auth=token)

    all_blocks = []
    has_more = True
    cursor = None
    chunk_index = 0

    while has_more:
        # Rate-limit progress callback
        async def _on_rl(delay, retry_num, _ci=chunk_index):
            if on_progress:
                await on_progress({
                    "chunk_index": _ci,
                    "blocks_so_far": len(all_blocks),
                    "has_more": True,
                    "markdown_chunk": "",
                    "status": "rate_limited",
                    "retry_after": delay,
                    "retry_num": retry_num,
                })

        # Use the global throttled call
        resp = await _notion_call_with_retry(
            lambda c=cursor: notion.blocks.children.list(
                block_id=page_id,
                start_cursor=c,
                page_size=BLOCKS_PER_PAGE,
            ),
            on_rate_limit=_on_rl,
        )

        # Process the page
        page_blocks = resp.get("results", [])
        all_blocks.extend(page_blocks)
        has_more = resp.get("has_more", False)
        cursor = resp.get("next_cursor")

        chunk_md = blocks_to_markdown(page_blocks)

        if on_progress:
            await on_progress({
                "chunk_index": chunk_index,
                "blocks_so_far": len(all_blocks),
                "has_more": has_more,
                "markdown_chunk": chunk_md,
                "status": "chunk",
            })

        chunk_index += 1

    # Final "done" progress event
    full_md = blocks_to_markdown(all_blocks)
    if on_progress:
        await on_progress({
            "chunk_index": chunk_index,
            "blocks_so_far": len(all_blocks),
            "has_more": False,
            "markdown_chunk": "",
            "status": "done",
            "total_blocks": len(all_blocks),
        })

    return full_md


async def pull_page_markdown(page_id: str, api_key: str = None) -> str:
    """Download a Notion page and convert it to plain Markdown (simple wrapper)."""
    return await pull_page_markdown_chunked(page_id, api_key=api_key)


# ---------------------------------------------------------
# Pushing (Markdown -> Notion Blocks)
# ---------------------------------------------------------

def _markdown_to_notion_blocks(markdown_text: str):
    """
    Very loose, naive parser to convert standard markdown into Notion Block objects.
    Handles: Paragraphs, H1, H2, H3, Bulleted Lists, Checkboxes.
    """
    blocks = []
    lines = markdown_text.split('\n')

    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue # Skip empty lines entirely for now, or insert empty paragraph

        # Headers
        if line_stripped.startswith('# '):
            blocks.append({
                "object": "block",
                "type": "heading_1",
                "heading_1": {"rich_text": [{"type": "text", "text": {"content": line_stripped[2:].strip()}}]}
            })
        elif line_stripped.startswith('## '):
            blocks.append({
                "object": "block",
                "type": "heading_2",
                "heading_2": {"rich_text": [{"type": "text", "text": {"content": line_stripped[3:].strip()}}]}
            })
        elif line_stripped.startswith('### '):
            blocks.append({
                "object": "block",
                "type": "heading_3",
                "heading_3": {"rich_text": [{"type": "text", "text": {"content": line_stripped[4:].strip()}}]}
            })
        # Bullet list
        elif line_stripped.startswith('- ') or line_stripped.startswith('* '):
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": [{"type": "text", "text": {"content": line_stripped[2:].strip()}}]}
            })
        # To do list
        elif line_stripped.startswith('- [ ] ') or line_stripped.startswith('- [x] '):
            checked = '[x]' in line_stripped[:6].lower()
            blocks.append({
                "object": "block",
                "type": "to_do",
                "to_do": {
                    "rich_text": [{"type": "text", "text": {"content": line_stripped[6:].strip()}}],
                    "checked": checked
                }
            })
        # standard paragraph
        else:
            blocks.append({
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": line_stripped}}]
                }
            })

    return blocks


async def push_markdown_to_page(page_id: str, markdown_text: str, api_key: str = None) -> bool:
    """Overwrite the content of a Notion page with converted Markdown blocks."""
    notion = get_notion_client(api_key)
    if not notion:
        raise ValueError("Notion client not configured. Set your token via the Notion button.")

    # 1. Fetch existing blocks (rate-limited)
    blocks_to_delete = []
    has_more = True
    next_cursor = None
    while has_more:
        resp = await _notion_call_with_retry(
            lambda c=next_cursor: notion.blocks.children.list(
                block_id=page_id, start_cursor=c
            )
        )
        blocks_to_delete.extend(resp.get("results", []))
        has_more = resp.get("has_more", False)
        next_cursor = resp.get("next_cursor")

    # 2. Delete existing blocks (rate-limited, one by one)
    delete_failures = 0
    for b in blocks_to_delete:
        try:
            await _notion_call_with_retry(
                lambda bid=b["id"]: notion.blocks.delete(block_id=bid)
            )
        except Exception as e:
            delete_failures += 1
            print(f"[Notion] Warning: Could not delete block {b['id']}: {e}")

    if delete_failures and delete_failures == len(blocks_to_delete) and blocks_to_delete:
        raise PermissionError(
            f"Notion integration lacks 'Delete content' permission on this page "
            f"({delete_failures}/{len(blocks_to_delete)} blocks could not be deleted). "
            "In Notion: open the page → ··· menu → Connections → your integration → ensure 'Can edit content' is enabled."
        )

    # 3. Parse Markdown → Notion blocks
    new_blocks = _markdown_to_notion_blocks(markdown_text)
    if not new_blocks:
        return True  # Nothing to push

    # 4. Append new blocks (max 100 per request, rate-limited)
    chunk_size = 100
    try:
        for i in range(0, len(new_blocks), chunk_size):
            chunk = new_blocks[i:i + chunk_size]
            await _notion_call_with_retry(
                lambda ch=chunk: notion.blocks.children.append(
                    block_id=page_id, children=ch
                )
            )
    except Exception as e:
        raise PermissionError(
            f"Notion push failed: {e}. "
            "Ensure your integration has 'Can edit content' permission on this page."
        )

    return True


# ---------------------------------------------------------
# Tree Exploration API (For UI Modal)
# ---------------------------------------------------------

async def fetch_notion_tree(api_key: str = None):
    """
    Fetch accessible pages out of the Notion workspace
    so the user can pick which one to link.
    Uses the global rate limiter.
    """
    notion = get_notion_client(api_key)
    if not notion:
        raise ValueError("Notion client not configured.")

    # Rate-limited search call
    resp = await _notion_call_with_retry(
        lambda: notion.search(
            query="",
            filter={"value": "page", "property": "object"},
            sort={"direction": "descending", "timestamp": "last_edited_time"},
            page_size=50
        )
    )

    tree = []
    for item in resp.get("results", []):
        # Extract title (sometimes nested weirdly)
        title = "Untitled"
        if "properties" in item:
            for prop_name, prop_data in item["properties"].items():
                if prop_data.get("type") == "title":
                    title_arr = prop_data.get("title", [])
                    if title_arr:
                        title = "".join([t.get("plain_text", "") for t in title_arr])
                    break

        tree.append({
            "id": item["id"],
            "title": title,
            "url": item.get("url", ""),
            "last_edited": item.get("last_edited_time", "")
        })

    return tree
