"""
Novellica — AI-Powered Story Writing Studio
Backend Server (FastAPI + File System DB)with Google Gemini integration, SSE streaming,
API key persistence, prompt editing, and hourly backups.
"""

import os
import io
import json
import asyncio
import shutil
import hashlib
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse
from google import genai
from google.genai import types
import openai
from pydantic import BaseModel
from typing import List, Optional
try:
    import web_automation
    HAS_WEB_AUTO = True
except ImportError:
    HAS_WEB_AUTO = False

import notion_sync

import tempfile
import os

try:
    import tts_kokoro
    HAS_TTS = True
except ImportError:
    HAS_TTS = False

ENV_FILE = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=ENV_FILE)

app = FastAPI(title="Novellica")

# Prevent browser caching of JS/CSS during development
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.endswith(('.js', '.css', '.html')):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)

# ---------------------------------------------------------------------------
# Gemini client — initialized lazily
# ---------------------------------------------------------------------------
_client = None
_client_key = ""


def _read_env_var(var_name: str) -> str:
    """Read a variable directly from the .env file (not cached os.environ)."""
    if not ENV_FILE.exists():
        return ""
    prefix = f"{var_name}="
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith(prefix):
            return stripped.split("=", 1)[1].strip()
    return ""

def _read_env_key() -> str:
    return _read_env_var("GEMINI_API_KEY")


def get_client(api_key: str | None = None) -> genai.Client:
    global _client, _client_key
    key = api_key or _read_env_key() or os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise ValueError("No Gemini API key configured.")
    # Recreate if key changed or client doesn't exist
    if _client is None or key != _client_key:
        _client = genai.Client(api_key=key)
        _client_key = key
    return _client

_openai_client = None
_openai_client_key = ""

def get_openai_client(api_key: str | None = None, base_url: str | None = None) -> openai.Client:
    global _openai_client, _openai_client_key
    key = api_key or _read_env_key() or os.getenv("GEMINI_API_KEY", "")
    url = base_url or _read_env_var("API_BASE_URL") or os.getenv("API_BASE_URL", "")
    if not key:
        raise ValueError("No API key configured.")
    if _openai_client is None or key != _openai_client_key:
        kwargs = {"api_key": key}
        if url:
            kwargs["base_url"] = url
        _openai_client = openai.Client(**kwargs)
        _openai_client_key = key
    return _openai_client


# ---------------------------------------------------------------------------
# Prompt templates — loaded from /projects/prompts directory
# ---------------------------------------------------------------------------
PROMPTS_DIR = Path(__file__).parent / "projects" / "prompts"
PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR = PROMPTS_DIR / "_backups"
BACKUP_DIR.mkdir(exist_ok=True)

# Track file hashes for change detection
_last_prompt_hashes: dict[str, str] = {}


def _prompt_hash(path: Path) -> str:
    """Simple hash of file contents for change detection."""
    try:
        return str(hash(path.read_text(encoding="utf-8")))
    except Exception:
        return ""


def _parse_prompt_file(f: Path) -> dict:
    """Parse a single .md prompt file into slug/name/description/body."""
    slug = f.stem
    text = f.read_text(encoding="utf-8")
    lines = text.strip().splitlines()
    name = lines[0].lstrip("# ").strip() if lines else slug
    description = ""
    body_start = 1
    if len(lines) > 1 and lines[1].startswith(">"):
        description = lines[1].lstrip("> ").strip()
        body_start = 2
    body = "\n".join(lines[body_start:]).strip()
    return {
        "slug": slug,
        "name": name,
        "description": description,
        "body": body,
    }


def load_prompts(force: bool = False) -> dict[str, dict]:
    """Load all .md prompt files from the prompts directory."""
    result = {}
    for f in sorted(PROMPTS_DIR.glob("*.md")):
        result[f.stem] = _parse_prompt_file(f)
    return result


# ---------------------------------------------------------------------------
# Hourly backup for prompts
# ---------------------------------------------------------------------------
_backup_task = None


async def _backup_loop():
    """Check prompt files every hour, back up any that changed."""
    while True:
        await asyncio.sleep(3600)  # 1 hour
        try:
            _do_backup()
        except Exception as exc:
            print(f"Backup error: {exc}")


def _do_backup():
    """Back up prompt files that changed since last check."""
    global _last_prompt_hashes
    now = datetime.now().strftime("%Y%m%d_%H%M%S")
    for f in PROMPTS_DIR.glob("*.md"):
        h = _prompt_hash(f)
        if f.stem in _last_prompt_hashes and _last_prompt_hashes[f.stem] == h:
            continue
        # Changed — create backup
        backup_file = BACKUP_DIR / f"{f.stem}_{now}.md"
        shutil.copy2(f, backup_file)
        _last_prompt_hashes[f.stem] = h
        print(f"  📦 Backed up {f.name} → {backup_file.name}")


@app.on_event("startup")
async def startup():
    global _backup_task
    # Sync existing .env key into keys.json so it appears in the key list
    env_key = _read_env_key()
    if env_key:
        _add_key_to_store(env_key)
    # Initialize prompt hashes
    for f in PROMPTS_DIR.glob("*.md"):
        _last_prompt_hashes[f.stem] = _prompt_hash(f)
    # Start hourly backup loop
    _backup_task = asyncio.create_task(_backup_loop())


# ---------------------------------------------------------------------------
# API Routes — Key Management
# ---------------------------------------------------------------------------


@app.get("/api/key")
async def get_key():
    """Return the stored API key (masked) and whether one exists.
    Reads directly from .env file so edits are picked up immediately."""
    key = _read_env_key()
    if not key:
        return {"exists": False, "masked": "", "key": ""}
    masked = key[:6] + "•" * (len(key) - 10) + key[-4:]
    return {"exists": True, "masked": masked, "key": key}


@app.post("/api/key")
async def save_key(request: Request):
    """Save API key to .env, validate it, and return available models."""
    body = await request.json()
    key = body.get("apiKey", "").strip()
    provider = body.get("provider", "google")
    base_url = body.get("baseUrl", "").strip()
    custom_models = body.get("customModels", [])

    if not base_url:
        if provider == "groq":
            base_url = "https://api.groq.com/openai/v1"
        elif provider == "openrouter":
            base_url = "https://openrouter.ai/api/v1"

    if not key:
        return JSONResponse({"error": "No key provided"}, status_code=400)

    # Validate by actually making a network request for Google,
    # but trust the user configuration for OpenAI endpoints.
    models = []
    if provider == "google":
        try:
            client = get_client(key)
            models = _list_models(client)
        except Exception as exc:
            return JSONResponse({"error": f"Invalid API key or validation failed: {str(exc)}"}, status_code=400)
    else:
        models = [{"id": m, "name": m, "description": f"{provider.capitalize()} Model"} for m in custom_models]

    # Save to .env file and keys.json
    os.environ["GEMINI_API_KEY"] = key
    os.environ["API_PROVIDER"] = provider
    os.environ["API_BASE_URL"] = base_url
    _write_env("GEMINI_API_KEY", key)
    _write_env("API_PROVIDER", provider)
    _write_env("API_BASE_URL", base_url)

    _add_key_to_store(key, provider=provider, base_url=base_url, custom_models=custom_models)

    return {"status": "ok", "models": models}


@app.get("/api/models")
async def list_models():
    """Return available models for the current API key/provider."""
    provider = _read_env_var("API_PROVIDER") or os.getenv("API_PROVIDER", "google")

    if provider == "google":
        try:
            client = get_client()
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        models = _list_models(client)
        return {"models": models}
    else:
        active_key = _read_env_key()
        keys = _load_keys()
        for k in keys:
            if k["key"] == active_key:
                custom_models = k.get("customModels", [])
                models = [{"id": m, "name": m, "description": f"{provider.capitalize()} Model"} for m in custom_models]
                return {"models": models}
        return {"models": []}


def _list_models(client) -> list[dict]:
    """Fetch and filter generative models from the Gemini API."""
    models = []
    try:
        for m in client.models.list():
            name = m.name or ""
            # Only include generateContent-capable models
            methods = getattr(m, "supported_generation_methods", []) or []
            if not methods:
                # Fallback: include if name contains 'gemini'
                if "gemini" not in name.lower():
                    continue
            elif "generateContent" not in methods:
                continue
            display = getattr(m, "display_name", "") or name.replace("models/", "")
            desc = getattr(m, "description", "") or ""
            models.append({
                "id": name.replace("models/", ""),
                "name": display,
                "description": desc[:120],
            })
    except Exception as exc:
        print(f"[models] Error listing models: {exc}")
    return models


def _write_env(var_name: str, value: str):
    """Write or update a variable in the .env file."""
    lines = []
    found = False
    if ENV_FILE.exists():
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    new_lines = []
    for line in lines:
        if line.startswith(f"{var_name}="):
            new_lines.append(f"{var_name}={value}")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"{var_name}={value}")
    ENV_FILE.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Multi-key storage — keys.json holds all keys ever used
# ---------------------------------------------------------------------------
KEYS_FILE = Path(__file__).parent / "keys.json"


def _load_keys() -> list[dict]:
    """Load all stored keys from keys.json."""
    if not KEYS_FILE.exists():
        return []
    try:
        data = json.loads(KEYS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_keys(keys: list[dict]):
    """Save keys list to keys.json."""
    KEYS_FILE.write_text(json.dumps(keys, indent=2), encoding="utf-8")


def _add_key_to_store(key: str, label: str = "", provider: str = "google", base_url: str = "", custom_models: Optional[list] = None):
    """Add a key to keys.json if it doesn't already exist."""
    keys = _load_keys()
    existing = False
    for k in keys:
        if k.get("key") == key:
            k["provider"] = provider
            k["baseUrl"] = base_url
            if custom_models is not None:
                k["customModels"] = custom_models
            existing = True
            break

    if not existing:
        if not label:
            label = f"Key #{len(keys) + 1} — {key[:8]}..."
        keys.append({
            "key": key,
            "label": label,
            "provider": provider,
            "baseUrl": base_url,
            "customModels": custom_models or [],
            "added": datetime.now().strftime("%Y-%m-%d %H:%M"),
        })
    _save_keys(keys)


def _mask_key(key: str) -> str:
    """Mask a key for display: show first 6 and last 4 chars."""
    if len(key) <= 10:
        return "•" * len(key)
    return key[:6] + "•" * (len(key) - 10) + key[-4:]


@app.get("/api/keys")
async def list_all_keys():
    """Return all stored API keys (masked) for the key selector UI."""
    keys = _load_keys()
    active_key = _read_env_key()
    result = []
    for k in keys:
        result.append({
            "key": k["key"],
            "label": k.get("label", ""),
            "provider": k.get("provider", "google"),
            "baseUrl": k.get("baseUrl", ""),
            "customModels": k.get("customModels", []),
            "masked": _mask_key(k["key"]),
            "added": k.get("added", ""),
            "active": k["key"] == active_key,
        })
    return result


@app.post("/api/key/select")
async def select_key(request: Request):
    """Switch the active key to one already stored in keys.json."""
    body = await request.json()
    key = body.get("apiKey", "").strip()
    if not key:
        return JSONResponse({"error": "No key provided"}, status_code=400)
    keys = _load_keys()
    k_obj = next((k for k in keys if k["key"] == key), None)
    if not k_obj:
        return JSONResponse({"error": "Key not found"}, status_code=404)

    provider = k_obj.get("provider", "google")
    base_url = k_obj.get("baseUrl", "")

    # Set as active in .env
    _write_env("GEMINI_API_KEY", key)
    _write_env("API_PROVIDER", provider)
    _write_env("API_BASE_URL", base_url)
    os.environ["GEMINI_API_KEY"] = key
    os.environ["API_PROVIDER"] = provider
    os.environ["API_BASE_URL"] = base_url

    # Force client recreation
    global _client, _client_key, _openai_client, _openai_client_key
    _client = None
    _client_key = ""
    _openai_client = None
    _openai_client_key = ""
    return {"status": "ok"}


@app.delete("/api/key")
async def delete_key(request: Request):
    """Remove a key from keys.json. Cannot delete the active key."""
    body = await request.json()
    key = body.get("apiKey", "").strip()
    active_key = _read_env_key()
    if key == active_key:
        return JSONResponse(
            {"error": "Cannot delete the active key. Switch to another first."},
            status_code=400,
        )
    keys = _load_keys()
    keys = [k for k in keys if k["key"] != key]
    _save_keys(keys)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# API Routes — Prompts
# ---------------------------------------------------------------------------


@app.get("/api/prompts")
async def list_prompts_endpoint():
    """Return all available prompt templates."""
    prompts = load_prompts()
    return [
        {"slug": p["slug"], "name": p["name"], "description": p["description"]}
        for p in prompts.values()
    ]


@app.get("/api/prompts/{slug}")
async def get_prompt(slug: str):
    """Return full body of a single prompt."""
    prompts = load_prompts()
    if slug not in prompts:
        return JSONResponse({"error": "Prompt not found"}, status_code=404)
    return prompts[slug]


@app.put("/api/prompts/{slug}")
async def update_prompt(slug: str, request: Request):
    """Update (save) a prompt file. Auto-backup if changed."""
    body = await request.json()
    new_body = body.get("body", "")
    name = body.get("name", slug)
    description = body.get("description", "")

    filepath = PROMPTS_DIR / f"{slug}.md"

    # Build file content
    content = f"# {name}\n"
    if description:
        content += f"> {description}\n"
    content += f"\n{new_body}\n"

    # Backup before overwrite if content changed
    if filepath.exists():
        old_hash = _prompt_hash(filepath)
        new_hash = str(hash(content))
        if old_hash != new_hash:
            now = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_file = BACKUP_DIR / f"{slug}_{now}.md"
            shutil.copy2(filepath, backup_file)

    filepath.write_text(content, encoding="utf-8")
    _last_prompt_hashes[slug] = _prompt_hash(filepath)

    return {"status": "ok"}


@app.get("/api/prompts/{slug}/backups")
async def list_backups(slug: str):
    """List all hourly backups for a prompt."""
    backups = []
    for f in sorted(BACKUP_DIR.glob(f"{slug}_*.md"), reverse=True):
        name = f.stem
        # Extract timestamp from filename
        ts_part = name.replace(f"{slug}_", "")
        try:
            dt = datetime.strptime(ts_part, "%Y%m%d_%H%M%S")
            label = dt.strftime("%b %d, %Y %I:%M %p")
        except ValueError:
            label = ts_part
        backups.append({
            "filename": f.name,
            "label": label,
            "timestamp": ts_part,
        })
    return backups


@app.get("/api/prompts/{slug}/backups/{filename}")
async def get_backup(slug: str, filename: str):
    """Return the content of a specific backup file."""
    filepath = BACKUP_DIR / filename
    if not filepath.exists():
        return JSONResponse({"error": "Backup not found"}, status_code=404)
    return {"content": filepath.read_text(encoding="utf-8")}


@app.delete("/api/prompts/{slug}")
async def delete_prompt(slug: str):
    """Delete a prompt file and its backups."""
    filepath = PROMPTS_DIR / f"{slug}.md"
    if filepath.exists():
        filepath.unlink()

    # Delete backups too
    for f in BACKUP_DIR.glob(f"{slug}_*.md"):
        f.unlink()

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# API Routes — Generate (streaming)
# ---------------------------------------------------------------------------


class WebGenerateRequest(BaseModel):
    prompt: str
    systemPrompt: Optional[str] = None
    history: Optional[List[dict]] = []

class TTSTextRequest(BaseModel):
    text: str
    path: Optional[str] = None
    voice: Optional[str] = None
    speed: Optional[float] = 1.0
    force: Optional[bool] = False

@app.post("/api/generate/web/auth")
async def web_auth():
    """
    Launch the browser to allow the user to authenticate manually.
    """
    if not HAS_WEB_AUTO:
        return JSONResponse(status_code=501, content={"error": "Web automation is disabled. Playwright is not installed."})
    try:
        # Just calling get_or_create_page starts the browser context.
        # It's an async fn.
        await web_automation.get_or_create_page()
        return {"status": "success", "message": "Browser launched. Please log in if necessary."}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/generate/web")
async def generate_story_web(req: WebGenerateRequest):
    """
    Generate using the visible Playwright browser session
    instead of the Gemini API.
    """
    full_prompt = req.prompt
    if req.systemPrompt:
        full_prompt = f"System Instructions:\n{req.systemPrompt}\n\nUser Request:\n{req.prompt}"

    async def event_stream():
        if not HAS_WEB_AUTO:
            import json
            yield f"data: {json.dumps({'error': 'Web automation is disabled. Playwright is not installed.'})}\n\n"
            return

        try:
            async for chunk in web_automation.stream_gemini_response(full_prompt):
                if chunk:
                    import json
                    yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as e:
            import json
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

@app.post("/api/generate")
async def generate(request: Request):
    """
    Stream a response via SSE.
    Body: { prompt, systemPrompt?, history?, apiKey?, model? }
    """
    body = await request.json()
    prompt = body.get("prompt", "")
    system_prompt = body.get("systemPrompt", "")
    history = body.get("history", [])
    model_name = body.get("model", "gemini-2.0-flash")

    provider = _read_env_var("API_PROVIDER") or os.getenv("API_PROVIDER", "google")

    if provider == "google":
        try:
            client = get_client()
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        contents = []
        for msg in history:
            role = "user" if msg.get("role") == "user" else "model"
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=msg["text"])]))
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=prompt)]))

        config = types.GenerateContentConfig(
            system_instruction=system_prompt if system_prompt else None,
            temperature=0.8,
            max_output_tokens=16384,
        )

        async def event_stream():
            try:
                response = client.models.generate_content_stream(
                    model=model_name,
                    contents=contents,
                    config=config,
                )
                for chunk in response:
                    if chunk.text:
                        yield {"event": "token", "data": json.dumps({"text": chunk.text})}
                        await asyncio.sleep(0)
                yield {"event": "done", "data": json.dumps({"status": "complete"})}
            except Exception as exc:
                yield {"event": "error", "data": json.dumps({"error": str(exc)})}

        return EventSourceResponse(event_stream())

    else:
        try:
            client = get_openai_client()
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        for msg in history:
            role = "user" if msg.get("role") == "user" else "assistant"
            messages.append({"role": role, "content": msg["text"]})

        messages.append({"role": "user", "content": prompt})

        async def event_stream_openai():
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    temperature=0.8,
                    max_tokens=8192,
                    stream=True
                )
                for chunk in response:
                    if len(chunk.choices) > 0:
                        delta = chunk.choices[0].delta.content
                        if delta:
                            yield {"event": "token", "data": json.dumps({"text": delta})}
                            await asyncio.sleep(0)
                yield {"event": "done", "data": json.dumps({"status": "complete"})}
            except Exception as exc:
                yield {"event": "error", "data": json.dumps({"error": str(exc)})}

        return EventSourceResponse(event_stream_openai())


# ---------------------------------------------------------------------------
# API Routes — File System (physical storage under /projects)
# ---------------------------------------------------------------------------
def _get_projects_dir() -> Path:
    from dotenv import dotenv_values
    env = dotenv_values(ENV_FILE)
    saved_dir = env.get("PROJECTS_DIR") or os.environ.get("PROJECTS_DIR")
    if saved_dir:
        p = Path(saved_dir)
        if p.exists() and p.is_dir():
            return p
    default_dir = Path(__file__).parent / "projects"
    default_dir.mkdir(exist_ok=True)
    return default_dir

PROJECTS_DIR = _get_projects_dir()

def _safe_path(rel: str) -> Path:
    """Resolve a relative path under PROJECTS_DIR, preventing traversal attacks."""
    global PROJECTS_DIR
    resolved = (PROJECTS_DIR / rel).resolve()
    if not str(resolved).startswith(str(PROJECTS_DIR.resolve())):
        raise ValueError("Path traversal detected")
    return resolved

# TTS Cache
TTS_CACHE_DIR = PROJECTS_DIR / "_tts_cache"
TTS_CACHE_DIR.mkdir(exist_ok=True)

def _get_tts_metadata(text: str, voice: str, speed: float) -> dict:
    """Generate metadata for a TTS request to track sync."""
    content_hash = hashlib.md5(text.encode('utf-8')).hexdigest()
    return {
        "hash": content_hash,
        "voice": voice,
        "speed": float(speed),
        "version": "1.0"
    }

def _get_tts_paths(rel_path: Optional[str]) -> tuple[Optional[Path], Optional[Path]]:
    """Get the physical paths for the wav and json sidecar for a given document path."""
    if not rel_path:
        return None, None
    # Sanitize: replace .md or other extensions with .wav for the cache
    p = Path(rel_path)
    # Mirror the relative structure inside _tts_cache
    cache_wav = TTS_CACHE_DIR / p.with_suffix(".wav")
    cache_json = TTS_CACHE_DIR / p.with_suffix(".json")
    return cache_wav, cache_json

@app.get("/api/fs/select-root")
def fs_select_root():
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    folder_path = filedialog.askdirectory(title="Select Project Directory")
    root.destroy()

    if folder_path:
        global PROJECTS_DIR
        PROJECTS_DIR = Path(folder_path)
        _write_env("PROJECTS_DIR", folder_path)
        os.environ["PROJECTS_DIR"] = folder_path
        return {"path": folder_path}
    return {"path": ""}

@app.post("/api/fs/open-dir")
async def fs_open_dir(request: Request):
    import subprocess
    body = await request.json()
    rel = body.get("path", "").strip()
    try:
        target = _safe_path(rel)
        if target.is_file():
            # If it's a file, open its parent directory and select it.
            if os.name == 'nt':
                subprocess.Popen(f'explorer /select,"{target}"')
            else:
                subprocess.Popen(['xdg-open', str(target.parent)])
        else:
            # It's a directory, just open it
            if os.name == 'nt':
                os.startfile(str(target))
            else:
                subprocess.Popen(['xdg-open', str(target)])
        return {"ok": True}
    except ValueError:
        return JSONResponse({"error": "Invalid path"}, status_code=400)

@app.get("/api/fs/tree")
async def fs_tree():
    """
    Return the full directory tree under /projects as a flat list.
    Each item: { path, name, type: 'file'|'folder', children: int }
    Hides internal folders like _tts_cache.
    """
    items = []
    # Use rglob but filter out hidden/internal directories
    for entry in sorted(PROJECTS_DIR.rglob("*")):
        try:
            rel = entry.relative_to(PROJECTS_DIR).as_posix()
            # Ignore hidden files, __pycache__, and _tts_cache
            if any(part.startswith('.') or part == '_tts_cache' or part == '__pycache__' for part in entry.parts):
                 continue

            if entry.is_dir():
                children = len(list(entry.iterdir()))
                items.append({"path": rel, "name": entry.name, "type": "folder", "children": children})
            else:
                size = entry.stat().st_size
                items.append({"path": rel, "name": entry.name, "type": "file", "size": size})
        except Exception:
            continue
    return items


@app.post("/api/fs/folder")
async def fs_create_folder(request: Request):
    """Create a folder. Body: { path: 'relative/path/to/folder' }"""
    body = await request.json()
    rel = body.get("path", "").strip()
    if not rel:
        return JSONResponse({"error": "Path required"}, status_code=400)
    try:
        target = _safe_path(rel)
        target.mkdir(parents=True, exist_ok=True)
        return {"ok": True, "path": rel}
    except ValueError:
        return JSONResponse({"error": "Invalid path"}, status_code=400)


@app.post("/api/fs/file")
async def fs_create_file(request: Request):
    """Create or overwrite a file. Body: { path, content? }"""
    body = await request.json()
    rel = body.get("path", "").strip()
    content = body.get("content", "")
    if not rel:
        return JSONResponse({"error": "Path required"}, status_code=400)
    try:
        target = _safe_path(rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"ok": True, "path": rel}
    except ValueError:
        return JSONResponse({"error": "Invalid path"}, status_code=400)


@app.get("/api/fs/file")
async def fs_read_file(path: str):
    """Read a file's content. Query: ?path=relative/path"""
    try:
        target = _safe_path(path)
        if not target.is_file():
            return JSONResponse({"error": "File not found"}, status_code=404)
        content = target.read_text(encoding="utf-8")
        return {"path": path, "name": target.name, "content": content}
    except ValueError:
        return JSONResponse({"error": "Invalid path"}, status_code=400)


@app.put("/api/fs/file")
async def fs_update_file(request: Request):
    """Update file content. Body: { path, content }"""
    body = await request.json()
    rel = body.get("path", "").strip()
    content = body.get("content", "")
    try:
        target = _safe_path(rel)
        if not target.is_file():
            return JSONResponse({"error": "File not found"}, status_code=404)
        target.write_text(content, encoding="utf-8")
        return {"ok": True, "path": rel}
    except ValueError:
        return JSONResponse({"error": "Invalid path"}, status_code=400)


@app.post("/api/fs/rename")
async def fs_rename(request: Request):
    """Rename a file or folder. Body: { oldPath, newPath }"""
    body = await request.json()
    old_rel = body.get("oldPath", "").strip()
    new_rel = body.get("newPath", "").strip()
    if not old_rel or not new_rel:
        return JSONResponse({"error": "Both oldPath and newPath required"}, status_code=400)
    try:
        old = _safe_path(old_rel)
        new = _safe_path(new_rel)
        if not old.exists():
            return JSONResponse({"error": "Source not found"}, status_code=404)
        if new.exists():
            return JSONResponse({"error": "Destination already exists"}, status_code=409)
        new.parent.mkdir(parents=True, exist_ok=True)
        old.rename(new)
        return {"ok": True, "oldPath": old_rel, "newPath": new_rel}
    except ValueError:
        return JSONResponse({"error": "Invalid path"}, status_code=400)


@app.post("/api/fs/smart-move")
async def fs_smart_move(request: Request):
    """Smart move: Moves items flexibly and automatically auto-creates any missing path structure."""
    body = await request.json()
    src_rel = body.get("sourcePath", "").strip()
    dest_folder = body.get("destFolder", "").strip()
    if not src_rel:
        return JSONResponse({"error": "sourcePath required"}, status_code=400)
    try:
        src = _safe_path(src_rel)
        if not src.exists():
            return JSONResponse({"error": "Source not found"}, status_code=404)

        if dest_folder:
            dest_dir = _safe_path(dest_folder)
            dest_dir.mkdir(parents=True, exist_ok=True)
        else:
            dest_dir = PROJECTS_DIR

        new_path = dest_dir / src.name

        if new_path.exists():
            return JSONResponse({"error": "Item already exists at destination"}, status_code=409)

        shutil.move(str(src), str(new_path))
        new_rel = new_path.relative_to(PROJECTS_DIR).as_posix()

        return {"ok": True, "newPath": new_rel}
    except ValueError:
        return JSONResponse({"error": "Invalid path"}, status_code=400)


@app.delete("/api/fs/item")
async def fs_delete(request: Request):
    """Delete a file or folder. Body: { path }"""
    body = await request.json()
    rel = body.get("path", "").strip()
    if not rel:
        return JSONResponse({"error": "Path required"}, status_code=400)
    try:
        target = _safe_path(rel)
        if not target.exists():
            return JSONResponse({"error": "Not found"}, status_code=404)
        if target.is_dir():
            shutil.rmtree(str(target))
        else:
            target.unlink()
        return {"ok": True}
    except ValueError:
        return JSONResponse({"error": "Invalid path"}, status_code=400)


@app.post("/api/fs/duplicate")
async def fs_duplicate(request: Request):
    """Duplicate a file. Body: { path }"""
    body = await request.json()
    rel = body.get("path", "").strip()
    if not rel:
        return JSONResponse({"error": "Path required"}, status_code=400)
    try:
        src = _safe_path(rel)
        if not src.is_file():
            return JSONResponse({"error": "File not found"}, status_code=404)
        stem = src.stem
        suffix = src.suffix
        parent = src.parent
        # Find unique name
        i = 1
        while True:
            new_name = f"{stem} ({i}){suffix}"
            new_path = parent / new_name
            if not new_path.exists():
                break
            i += 1
        shutil.copy2(str(src), str(new_path))
        new_rel = new_path.relative_to(PROJECTS_DIR).as_posix()
        return {"ok": True, "newPath": new_rel}
    except ValueError:
        return JSONResponse({"error": "Invalid path"}, status_code=400)


# ==============================================================================
# TTS — Kokoro v1.0 (82M) Engine
# ==============================================================================


@app.get("/api/tts/voices")
async def list_tts_voices():
    """Return available Kokoro TTS voices."""
    if not HAS_TTS:
        return JSONResponse({"error": "Kokoro TTS is not installed."}, status_code=500)
    voices = tts_kokoro.get_voices()
    default = tts_kokoro.DEFAULT_VOICE
    return {
        "voices": [{"id": k, "name": v} for k, v in voices.items()],
        "default": default,
    }


@app.post("/api/tts")
async def generate_tts(req: TTSTextRequest):
    """
    Generate TTS audio using Kokoro v1.0 (82M).
    Returns a complete WAV file. Path-based caching with hash verify.
    """
    if not HAS_TTS:
        return JSONResponse({"error": "Kokoro TTS is not installed."}, status_code=500)

    text = tts_kokoro.clean_text_for_tts(req.text)
    if not text:
        return JSONResponse({"error": "Text is empty"}, status_code=400)

    voice = req.voice or tts_kokoro.DEFAULT_VOICE
    speed = req.speed or 1.0

    # Path-based mirrors
    cache_wav, cache_json = _get_tts_paths(req.path)
    metadata = _get_tts_metadata(text, voice, speed)

    try:
        # Check cache (only if path provided and not forcing)
        if cache_wav and cache_wav.exists() and cache_json and cache_json.exists() and not req.force:
            try:
                stored_meta = json.loads(cache_json.read_text(encoding="utf-8"))
                if stored_meta.get("hash") == metadata["hash"] and \
                   stored_meta.get("voice") == metadata["voice"] and \
                   abs(stored_meta.get("speed", 0) - metadata["speed"]) < 0.01:
                    print(f"[TTS/Cache] Serving fresh path-mirrored audio: {req.path}")
                    return FileResponse(
                        cache_wav,
                        media_type="audio/wav",
                        filename=cache_wav.name
                    )
            except Exception as e:
                print(f"[TTS/Cache] Metadata read failed for {req.path}: {e}")

        # Generate fresh
        wav_bytes = await tts_kokoro.generate_full(text, voice=voice, speed=speed)

        # Save to mirrored cache if path exists
        if cache_wav and cache_json:
            cache_wav.parent.mkdir(parents=True, exist_ok=True)
            cache_wav.write_bytes(wav_bytes)
            cache_json.write_text(json.dumps(metadata), encoding="utf-8")
            print(f"[TTS/Cache] Saved fresh path-mirrored audio: {req.path}")

        return StreamingResponse(
            io.BytesIO(wav_bytes),
            media_type="audio/wav",
            headers={"Content-Disposition": f"inline; filename={cache_wav.name if cache_wav else 'tts.wav'}"},
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": f"TTS Error: {str(e)}"}, status_code=500)


@app.post("/api/tts/stream")
async def generate_tts_stream(req: TTSTextRequest):
    """
    Stream TTS audio in chunks. Supports path-based cache check.
    """
    if not HAS_TTS:
        return JSONResponse({"error": "Kokoro TTS is not installed."}, status_code=500)

    text = tts_kokoro.clean_text_for_tts(req.text)
    if not text:
        return JSONResponse({"error": "Text is empty after cleaning"}, status_code=400)

    voice = req.voice or tts_kokoro.DEFAULT_VOICE
    speed = req.speed or 1.0

    # Path-based check
    cache_wav, _ = _get_tts_paths(req.path)
    # Note: Stream cached check is limited as it just sends everything at once if cached
    # In a real stream we'd want to preserve the chunking, but for cache hits we just dump the file.
    if cache_wav and cache_wav.exists() and not req.force:
        print(f"[TTS/Stream/Cache] Serving path-mirrored stream: {req.path}")
        async def cached_stream():
            try:
                 with open(cache_wav, "rb") as f:
                     data = f.read()
                     yield len(data).to_bytes(4, byteorder='big') + data
            except Exception as e:
                 print(f"[TTS/Stream/Cache] Error reading cache: {e}")
        return StreamingResponse(cached_stream(), media_type="application/octet-stream")

    async def audio_stream():
        try:
            async for wav_chunk in tts_kokoro.generate_stream(text, voice=voice, speed=speed):
                # Send length-prefixed binary chunks
                length = len(wav_chunk)
                yield length.to_bytes(4, byteorder='big') + wav_chunk
        except Exception as e:
            print(f"[TTS/Stream] Error: {e}")

    return StreamingResponse(
        audio_stream(),
        media_type="application/octet-stream",
        headers={
            "X-TTS-Sample-Rate": str(tts_kokoro.SAMPLE_RATE),
            "X-TTS-Voice": voice,
        },
    )

class BackupRequest(BaseModel):
    description: str = "Manual Backup"

@app.post("/api/backup-code")
async def create_code_backup(req: BackupRequest):
    try:
        base_dir = Path(__file__).parent
        now = datetime.now()
        # Custom format asked by user, or dynamic
        folder_name = "Backup" + now.strftime("%d%b%Y_%I%M").lstrip("0") + now.strftime("%p").lower()

        backups_root = base_dir / "Backup"
        backups_root.mkdir(exist_ok=True)
        backup_dir = backups_root / folder_name

        if backup_dir.exists():
            return JSONResponse({"error": "Backup already exists"}, status_code=400)

        def ignore_patterns(d, contents):
            # Ignore anything that looks like a story file or is unnecessary
            ign = []
            for c in contents:
                if c in ("projects", "Story-Refined", "venv", ".git", ".gemini", "__pycache__", "node_modules"):
                    ign.append(c)
                elif "Backup" in c:
                    ign.append(c)
            return ign

        shutil.copytree(str(base_dir), str(backup_dir), ignore=ignore_patterns)

        # Log to project_logs.md
        log_file = base_dir / "project_logs.md"
        entry = f"## {folder_name} - {now.strftime('%Y-%m-%d %H:%M:%S')}\n**Modifications/Features:** {req.description}\n\n"

        with open(log_file, "a", encoding="utf-8") as f:
            f.write(entry)

        return {"ok": True, "path": str(backup_dir), "folder_name": folder_name}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/backups")
async def get_backups():
    try:
        base_dir = Path(__file__).parent
        log_file = base_dir / "project_logs.md"
        if not log_file.exists():
            return JSONResponse([])

        content = log_file.read_text(encoding="utf-8")
        backups = []

        # Super simple parser
        sections = content.split("## ")
        for sec in sections:
            sec = sec.strip()
            if not sec:
                continue
            lines = sec.split("\n")
            header = lines[0].strip()
            if not header.startswith("Backup"):
                continue # Only parse backup sections

            desc = ""
            for line in lines[1:]:
                if line.startswith("**Modifications/Features:**"):
                    desc = line.replace("**Modifications/Features:**", "").strip()
                    break

            folder_name = header.split(" - ")[0] if " - " in header else header
            backup_path = str(base_dir / "Backup" / folder_name)

            backups.append({
                "name": folder_name,
                "description": desc,
                "path": backup_path
            })

        # Return newest first
        backups.reverse()
        return JSONResponse(backups)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

class OpenFolderRequest(BaseModel):
    path: str

@app.post("/api/open-folder")
async def open_folder(req: OpenFolderRequest):
    try:
        import os
        if os.name == 'nt':
            os.startfile(req.path)
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

# ---------------------------------------------------------------------------
# API Routes — Notion Integration
# ---------------------------------------------------------------------------

@app.get("/api/notion/token")
async def get_notion_token():
    """Return the stored Notion integration token."""
    token = _read_env_var("NOTION_INTEGRATION_TOKEN")
    return {"token": token, "exists": bool(token)}

@app.post("/api/notion/token")
async def save_notion_token(request: Request):
    """Save Notion integration token to .env"""
    body = await request.json()
    token = body.get("token", "").strip()

    os.environ["NOTION_INTEGRATION_TOKEN"] = token
    _write_env("NOTION_INTEGRATION_TOKEN", token)
    return {"status": "ok"}

@app.get("/api/notion/mapping")
async def get_notion_mapping(project: str):
    """Return the saved file-to-page mappings for a project."""
    return notion_sync.load_notion_map(project)

@app.post("/api/notion/tree")
async def post_notion_tree(request: Request):
    """Fetch recent pages from Notion."""
    body = await request.json()
    token = body.get("token")
    try:
        tree = await notion_sync.fetch_notion_tree(api_key=token)
        return tree
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/api/notion/pull")
async def post_notion_pull(request: Request):
    """Pull content from a Notion page to a local file."""
    body = await request.json()
    page_id = body.get("page_id")
    token = body.get("token")
    save_path = body.get("save_path") # if present, we write to disk
    project_name = body.get("project_name", "default")

    try:
        content = await notion_sync.pull_page_markdown(page_id, api_key=token)

        if save_path:
            # Write to disk and register mapping
            target = _safe_path(save_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            notion_sync.set_page_mapping(project_name, save_path, page_id)
            return {"ok": True, "path": save_path, "content": content}

        return {"content": content}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/notion/pull-stream")
async def post_notion_pull_stream(request: Request):
    """
    Pull content from a Notion page using chunked fetching with progress
    reporting via Server-Sent Events.  Handles rate limits automatically.
    """
    body = await request.json()
    page_id = body.get("page_id")
    token = body.get("token")
    save_path = body.get("save_path")
    project_name = body.get("project_name", "default")

    progress_queue: asyncio.Queue = asyncio.Queue()

    async def _on_progress(info: dict):
        print(f"[Notion/Stream] Progress: status={info.get('status')}, blocks={info.get('blocks_so_far',0)}, chunk={info.get('chunk_index',0)}")
        await progress_queue.put(info)

    async def _pull_task():
        try:
            print(f"[Notion/Stream] Starting chunked pull for page {page_id}")
            content = await notion_sync.pull_page_markdown_chunked(
                page_id, api_key=token, on_progress=_on_progress
            )
            print(f"[Notion/Stream] Pull complete, content length: {len(content)}")
            await progress_queue.put({"status": "complete", "content": content})
        except Exception as exc:
            print(f"[Notion/Stream] Pull error: {exc}")
            await progress_queue.put({"status": "error", "error": str(exc)})

    async def event_stream():
        task = asyncio.create_task(_pull_task())
        try:
            while True:
                if await request.is_disconnected():
                    print(f"[Notion/Stream] Client disconnected from stream for {page_id}")
                    break

                try:
                    info = await asyncio.wait_for(progress_queue.get(), timeout=1.5)
                except asyncio.TimeoutError:
                    # Yield a ping to force a socket write. If the client has disconnected
                    # (via the Stop button), this write will fail or trigger sse_starlette
                    # to close the generator, enforcing task cancellation.
                    yield {
                        "event": "ping",
                        "data": json.dumps({"status": "ping"})
                    }
                    continue

                status = info.get("status", "")

                if status == "chunk":
                    yield {
                        "event": "progress",
                        "data": json.dumps({
                            "status": "chunk",
                            "chunk_index": info["chunk_index"],
                            "blocks_so_far": info["blocks_so_far"],
                            "has_more": info["has_more"],
                            "markdown_chunk": info["markdown_chunk"],
                        }),
                    }
                elif status == "rate_limited":
                    yield {
                        "event": "progress",
                        "data": json.dumps({
                            "status": "rate_limited",
                            "retry_after": info.get("retry_after", 2),
                            "retry_num": info.get("retry_num", 1),
                            "blocks_so_far": info.get("blocks_so_far", 0),
                        }),
                    }
                elif status == "done":
                    yield {
                        "event": "progress",
                        "data": json.dumps({
                            "status": "done",
                            "total_blocks": info.get("total_blocks", 0),
                        }),
                    }
                elif status == "complete":
                    # All blocks fetched — save file if requested
                    content = info["content"]
                    if save_path:
                        target = _safe_path(save_path)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_text(content, encoding="utf-8")
                        notion_sync.set_page_mapping(project_name, save_path, page_id)

                    yield {
                        "event": "complete",
                        "data": json.dumps({
                            "ok": True,
                            "content": content,
                            "path": save_path,
                        }),
                    }
                    break
                elif status == "error":
                    yield {
                        "event": "error",
                        "data": json.dumps({"error": info.get("error", "Unknown error")}),
                    }
                    break

                await asyncio.sleep(0)
        except asyncio.CancelledError:
            print(f"[Notion/Stream] Client disconnected, cancelling task for {page_id}")
            raise
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    return EventSourceResponse(event_stream())

@app.post("/api/notion/push")
async def post_notion_push(request: Request):
    """Push local file content to a Notion page."""
    body = await request.json()
    page_id = body.get("page_id")
    token = body.get("token")
    content = body.get("content")
    file_path = body.get("file_path")
    project_name = body.get("project_name", "default")

    try:
        await notion_sync.push_markdown_to_page(page_id, content, api_key=token)
        if file_path:
            notion_sync.set_page_mapping(project_name, file_path, page_id)
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

# ---------------------------------------------------------------------------
# Static files — serve the frontend
# ---------------------------------------------------------------------------
PUBLIC_DIR = Path(__file__).parent / "public"
PUBLIC_DIR.mkdir(exist_ok=True)


@app.get("/")
async def index():
    return FileResponse(PUBLIC_DIR / "index.html")


app.mount("/projects", StaticFiles(directory=PROJECTS_DIR), name="projects")
app.mount("/", StaticFiles(directory="public", html=True), name="public")

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    print("\n  >>> Novellica running at http://localhost:5000\n")
    uvicorn.run("server:app", host="0.0.0.0", port=5000, reload=True)
