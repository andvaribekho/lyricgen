import asyncio
import json
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from aligner import LyricAligner

app = FastAPI(title="Lyric & Audio Forced-Alignment Tool")

BASE_DIR = Path(__file__).parent
UPLOADS_DIR = BASE_DIR / "uploads"
OUTPUTS_DIR = BASE_DIR / "outputs"
UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

progress_store: dict = {}


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/progress/{job_id}")
async def stream_progress(job_id: str):
    async def event_generator():
        if job_id not in progress_store:
            progress_store[job_id] = {"status": "queued", "progress": 0, "message": ""}

        last_status = None
        while True:
            state = progress_store.get(job_id, {})
            current = json.dumps(state)
            if current != last_status:
                last_status = current
                yield f"data: {current}\n\n"
            if state.get("status") in ("complete", "error"):
                break
            await asyncio.sleep(0.3)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/upload")
async def upload_files(
    audio: UploadFile = File(...),
    lyrics: UploadFile = File(...),
    model: str = Form("base"),
):
    job_id = str(uuid.uuid4())
    job_dir = UPLOADS_DIR / job_id
    job_dir.mkdir(exist_ok=True)

    audio_path = job_dir / audio.filename
    lyrics_path = job_dir / lyrics.filename

    audio_content = await audio.read()
    with open(audio_path, "wb") as f:
        f.write(audio_content)

    lyrics_content = await lyrics.read()
    with open(lyrics_path, "wb") as f:
        f.write(lyrics_content)

    progress_store[job_id] = {"status": "uploaded", "progress": 0, "message": "Files uploaded"}

    thread = threading.Thread(
        target=run_alignment,
        args=(job_id, str(audio_path), str(lyrics_path), model),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


def run_alignment(job_id: str, audio_path: str, lyrics_path: str, model_size: str):
    try:
        progress_store[job_id] = {
            "status": "downloading_model",
            "progress": 10,
            "message": f"Loading Whisper {model_size} model...",
        }

        with open(lyrics_path, "r", encoding="utf-8") as f:
            lyrics_text = f.read()

        aligner = LyricAligner(model_size=model_size)

        progress_store[job_id] = {
            "status": "transcribing",
            "progress": 30,
            "message": "Transcribing audio with Whisper...",
        }

        result = aligner.run(audio_path, lyrics_text)

        progress_store[job_id] = {
            "status": "aligning",
            "progress": 70,
            "message": "Aligning lyrics with transcription...",
        }

        output = aligner.format_output(result)

        out_json = OUTPUTS_DIR / f"{job_id}.json"
        out_txt = OUTPUTS_DIR / f"{job_id}.txt"
        out_txt_b = OUTPUTS_DIR / f"{job_id}_b.txt"

        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        with open(out_txt, "w", encoding="utf-8") as f:
            for w in output:
                f.write(
                    f"[{w['start_ms']}ms -> {w['end_ms']}ms] {w['word']} "
                    f"(phrase: \"{w['phrase']}\")\n"
                )

        phrase_map = {}
        next_id = 1
        phrase_order = []
        for w in output:
            p = w["phrase"]
            if p not in phrase_map:
                phrase_map[p] = next_id
                phrase_order.append(p)
                next_id += 1

        with open(out_txt_b, "w", encoding="utf-8") as f:
            f.write("# format: words-guided\n")
            for w in output:
                group_id = phrase_map[w["phrase"]]
                f.write(f"{w['start_ms']} {w['end_ms']} @{group_id} {w['word']}\n")

        progress_store[job_id] = {
            "status": "complete",
            "progress": 100,
            "message": "Alignment complete!",
            "result": output,
            "job_id": job_id,
        }

    except Exception as e:
        progress_store[job_id] = {
            "status": "error",
            "progress": 0,
            "message": f"Error: {str(e)}",
        }


@app.get("/api/download/{job_id}.json")
async def download_json(job_id: str):
    path = OUTPUTS_DIR / f"{job_id}.json"
    if not path.exists():
        return {"error": "File not found"}
    return FileResponse(path, filename=f"lyric_alignment_{job_id}.json")


@app.get("/api/download/{job_id}.txt")
async def download_txt(job_id: str):
    path = OUTPUTS_DIR / f"{job_id}.txt"
    if not path.exists():
        return {"error": "File not found"}
    return FileResponse(path, filename=f"lyric_alignment_{job_id}.txt")


@app.get("/api/download/{job_id}_b.txt")
async def download_txt_b(job_id: str):
    path = OUTPUTS_DIR / f"{job_id}_b.txt"
    if not path.exists():
        return {"error": "File not found"}
    return FileResponse(path, filename=f"lyric_alignment_{job_id}_b.txt")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        timeout_keep_alive=120,
    )
