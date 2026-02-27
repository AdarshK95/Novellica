import io
import os
import re
import asyncio
import tempfile
import threading
import warnings
import queue as queue_mod
import numpy as np
from pathlib import Path

# Suppress noisy library warnings
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

# Suppress transformers/huggingface noise
try:
    from transformers import logging as transformers_logging
    transformers_logging.set_verbosity_error()
except ImportError:
    pass

# Defer massive imports to improve startup speed/reload speed
KPipeline = None
sf = None

# American & British English voices
VOICES = {
    # American English (US)
    "af_heart": "Heart (US Female)",
    "af_alloy": "Alloy (US Female)",
    "af_aoede": "Aoede (US Female)",
    "af_bella": "Bella (US Female)",
    "af_jessica": "Jessica (US Female)",
    "af_kore": "Kore (US Female)",
    "af_nicole": "Nicole (US Female)",
    "af_river": "River (US Female)",
    "af_sarah": "Sarah (US Female)",
    "af_sky": "Sky (US Female)",
    "am_adam": "Adam (US Male)",
    "am_echo": "Echo (US Male)",
    "am_eric": "Eric (US Male)",
    "am_fenrir": "Fenrir (US Male)",
    "am_liam": "Liam (US Male)",
    "am_michael": "Michael (US Male)",
    "am_onyx": "Onyx (US Male)",
    "am_puck": "Puck (US Male)",
    "am_santa": "Santa (US Male)",

    # British English (UK)
    "bf_alice": "Alice (UK Female)",
    "bf_bella": "Bella (UK Female)",
    "bf_emma": "Emma (UK Female)",
    "bf_isabella": "Isabella (UK Female)",
    "bm_fable": "Fable (UK Male)",
    "bm_george": "George (UK Male)",
    "bm_lewis": "Lewis (UK Male)",

    # Japanese
    "jf_alpha": "Alpha (JP Female)",
    "jf_gongitsune": "Gongitsune (JP Female)",
    "jf_nezumi": "Nezumi (JP Female)",
    "jf_tebukuro": "Tebukuro (JP Female)",
    "jm_kumo": "Kumo (JP Male)",

    # Spanish
    "ef_dora": "Dora (ES Female)",
    "em_alex": "Alex (ES Male)",
    "em_santa": "Santa (ES Male)",

    # French
    "ff_siwis": "Siwis (FR Female)",

    # Hindi
    "hf_alpha": "Alpha (HI Female)",
    "hf_beta": "Beta (HI Female)",
    "hm_omega": "Omega (HI Male)",
    "hm_psi": "Psi (HI Male)",

    # Italian
    "if_sara": "Sara (IT Female)",
    "im_nicola": "Nicola (IT Male)",

    # Brazilian Portuguese
    "pf_dora": "Dora (BR Female)",
    "pm_alex": "Alex (BR Male)",
    "pm_santa": "Santa (BR Male)",
}

DEFAULT_VOICE = "af_heart"
SAMPLE_RATE = 24000
MAX_CHUNK_LEN = 1500  # Characters per internal chunk to avoid model lag

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------
_pipeline = None
_pipeline_lock = asyncio.Lock()


def _get_lang_code(voice: str) -> str:
    """Detect language code from voice prefix (e.g. 'af' -> 'a', 'bf' -> 'b')"""
    prefix = voice[0] if len(voice) > 0 else 'a'
    if prefix in ['a', 'b', 'j', 'z', 'e', 'f', 'h', 'i', 'p']:
        return prefix
    return 'a'


def clean_text_for_tts(text: str) -> str:
    """
    Remove markdown, HTML, and garbage. Keep common punctuation.
    """
    if not text:
        return ""
    # 1. Remove Markdown links [text](url) -> text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    # 2. Remove Markdown image tags ![alt](url) -> ""
    text = re.sub(r'!\[[^\]]*\]\([^\)]+\)', '', text)
    # 3. Remove most Markdown formatting
    text = re.sub(r'[#*_~`>|-]', '', text)
    # 4. Remove HTML-like tags
    text = re.sub(r'<[^>]+>', '', text)
    # 5. Remove problematic non-printable or control characters
    text = "".join(c for c in text if c.isprintable() or c in "\n ")
    # 6. Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def split_text_into_chunks(text: str, max_len: int = MAX_CHUNK_LEN) -> list:
    """
    Splits long text into pieces small enough for the model to handle without error.
    Tries to split at sentence boundaries (. ! ?) first.
    """
    if not text:
        return []

    # Split by simple punctuation to preserve meaning
    raw_pieces = re.split(r'([.!?]+)', text)
    chunks = []
    current_chunk = ""

    for i in range(0, len(raw_pieces), 2):
        sentence = raw_pieces[i]
        punct = raw_pieces[i+1] if i+1 < len(raw_pieces) else ""
        full_sentence = (sentence + punct).strip()

        if not full_sentence:
            continue

        if len(current_chunk) + len(full_sentence) < max_len:
            current_chunk += (" " if current_chunk else "") + full_sentence
        else:
            if current_chunk:
                chunks.append(current_chunk)

            # If a single sentence is still too long, hard split it
            if len(full_sentence) > max_len:
                for j in range(0, len(full_sentence), max_len):
                    chunks.append(full_sentence[j:j+max_len])
                current_chunk = ""
            else:
                current_chunk = full_sentence

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def _init_pipeline_sync(lang_code: str = 'a'):
    global KPipeline, sf
    if KPipeline is None:
        from kokoro import KPipeline
    if sf is None:
        import soundfile as sf
    return KPipeline(lang_code=lang_code, repo_id='hexgrad/Kokoro-82M')


async def preload_model(lang_code='a'):
    """Pre-load model without generating anything."""
    global _pipeline
    async with _pipeline_lock:
        if _pipeline is None:
            _pipeline = await asyncio.to_thread(_init_pipeline_sync, lang_code)


def _free_pipeline():
    """Explicitly delete the pipeline to free up memory/VRAM."""
    global _pipeline
    if _pipeline is not None:
        print("[TTS/Kokoro] Cleaning up model memory...")
        try:
            del _pipeline
        except NameError:
            pass
        _pipeline = None

        # If torch is available, clear cache
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except:
            pass


async def generate_full(text: str, voice: str = DEFAULT_VOICE, speed: float = 1.0) -> bytes:
    """
    Full audio generation with on-demand loading and text splitting.
    """
    global _pipeline
    text = clean_text_for_tts(text)
    if not text:
        raise ValueError("No text provided for TTS")

    async with _pipeline_lock:
        try:
            if _pipeline is None:
                lang = _get_lang_code(voice)
                print(f"[TTS/Kokoro] Loading model (lang={lang}) for document ({len(text.split())} words)...")
                _pipeline = await asyncio.to_thread(_init_pipeline_sync, lang)

            # Split into chunks of sentences
            text_chunks = split_text_into_chunks(text)
            audio_chunks = []

            for i, chunk in enumerate(text_chunks):
                print(f"[TTS/Kokoro] Processing chunk {i+1}/{len(text_chunks)}")
                audio = await asyncio.to_thread(_generate_single_chunk_sync, chunk, voice, speed)
                if audio is not None and len(audio) > 0:
                    audio_chunks.append(audio)

            if not audio_chunks:
                raise RuntimeError("No audio generated from chunks")

            full_audio = np.concatenate(audio_chunks)
            buf = io.BytesIO()
            sf.write(buf, full_audio, SAMPLE_RATE, format='WAV')
            buf.seek(0)
            return buf.read()
        except Exception as e:
            print(f"[TTS/Kokoro] Generate error: {e}")
            raise


def _generate_single_chunk_sync(chunk: str, voice: str, speed: float):
    """Internal synchronous helper for one piece of text."""
    global _pipeline
    if _pipeline is None:
        return None

    generator = _pipeline(
        chunk,
        voice=voice,
        speed=speed,
        split_pattern=r'\n+'
    )

    sub_chunks = []
    for _, (_, _, audio) in enumerate(generator):
        if audio is not None and len(audio) > 0:
            sub_chunks.append(audio)

    return np.concatenate(sub_chunks) if sub_chunks else None


async def generate_stream(text: str, voice: str = DEFAULT_VOICE, speed: float = 1.0):
    """
    Streaming generation with splitting for stability and on-demand model lifecycle.
    """
    global _pipeline
    text = clean_text_for_tts(text)
    if not text:
        return

    async with _pipeline_lock:
        try:
            if _pipeline is None:
                lang = _get_lang_code(voice)
                print(f"[TTS/Kokoro] Opening stream (lang={lang}) for document...")
                _pipeline = await asyncio.to_thread(_init_pipeline_sync, lang)

            text_chunks = split_text_into_chunks(text)

            for i, chunk in enumerate(text_chunks):
                generator = _pipeline(
                    chunk,
                    voice=voice,
                    speed=speed,
                    split_pattern=r'\n+'
                )

                for _, (_, _, audio) in enumerate(generator):
                    if audio is not None and len(audio) > 0:
                        buf = io.BytesIO()
                        sf.write(buf, audio, SAMPLE_RATE, format='WAV')
                        buf.seek(0)
                        yield buf.read()

                # Minimal sleep between chunks to stay responsive
                await asyncio.sleep(0.01)
        except Exception as e:
            print(f"[TTS/Kokoro] Stream error: {e}")


def get_voices() -> dict:
    return VOICES
