import json
import re
import os
from dataclasses import dataclass, field
from typing import List, Optional

import difflib
import whisper
import numpy as np


@dataclass
class AlignedWord:
    start_ms: int
    end_ms: int
    word: str
    phrase: str


class LyricAligner:
    def __init__(self, model_size: str = "base", device: Optional[str] = None):
        self.model_size = model_size
        if device is None:
            if os.environ.get("FORCE_CPU"):
                device = "cpu"
            else:
                device = "cpu"
        self.device = device
        self._model = None

    @property
    def model(self):
        if self._model is None:
            self._model = whisper.load_model(self.model_size, device=self.device)
        return self._model

    def normalize_text(self, text: str) -> str:
        text = text.lower().strip()
        text = re.sub(r"[^\w\s]", "", text)
        text = re.sub(r"\s+", " ", text)
        return text

    def parse_lyrics(self, lyrics_text: str) -> List[dict]:
        lines = lyrics_text.strip().split("\n")
        entries = []
        for line in lines:
            phrase = line.strip()
            if not phrase:
                continue
            norm_phrase = self.normalize_text(phrase)
            words = norm_phrase.split()
            for word in words:
                entries.append({
                    "word": word,
                    "phrase": phrase,
                })
        return entries

    def transcribe(self, audio_path: str) -> List[dict]:
        result = self.model.transcribe(
            audio_path,
            word_timestamps=True,
            language=None,
        )
        segments = result.get("segments", [])
        whisper_words = []
        for seg in segments:
            for w in seg.get("words", []):
                word_text = self.normalize_text(w["word"])
                whisper_words.append({
                    "word": word_text,
                    "start": w["start"],
                    "end": w["end"],
                })
        return whisper_words

    def align(
        self,
        lyrics_entries: List[dict],
        whisper_words: List[dict],
    ) -> List[dict]:
        lyrics_indexes = [e["word"] for e in lyrics_entries]
        whisper_indexes = [w["word"] for w in whisper_words]

        matcher = difflib.SequenceMatcher(
            None,
            lyrics_indexes,
            whisper_indexes,
        )
        matches = []
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                for k in range(i2 - i1):
                    lyrics_idx = i1 + k
                    whisper_idx = j1 + k
                    matches.append({
                        "lyrics_idx": lyrics_idx,
                        "whisper_idx": whisper_idx,
                        "matched": True,
                    })
            elif tag == "replace":
                lyrics_block = lyrics_indexes[i1:i2]
                whisper_block = whisper_indexes[j1:j2]
                for idx_in_block, lyrics_idx in enumerate(range(i1, i2)):
                    best_j = None
                    if whisper_block:
                        sims = [
                            difflib.SequenceMatcher(None, lyrics_block[idx_in_block], w).ratio()
                            for w in whisper_block
                        ]
                        if max(sims) > 0.5:
                            best_j = j1 + sims.index(max(sims))
                    matches.append({
                        "lyrics_idx": lyrics_idx,
                        "whisper_idx": best_j,
                        "matched": best_j is not None,
                    })
            elif tag == "delete":
                for lyrics_idx in range(i1, i2):
                    matches.append({
                        "lyrics_idx": lyrics_idx,
                        "whisper_idx": None,
                        "matched": False,
                    })
            elif tag == "insert":
                pass

        matches.sort(key=lambda m: m["lyrics_idx"])

        aligned = []
        for match in matches:
            entry = lyrics_entries[match["lyrics_idx"]]
            if match["matched"] and match["whisper_idx"] is not None:
                ww = whisper_words[match["whisper_idx"]]
                aligned.append({
                    "start_ms": int(round(ww["start"] * 1000)),
                    "end_ms": int(round(ww["end"] * 1000)),
                    "word": entry["word"],
                    "phrase": entry["phrase"],
                })
            else:
                aligned.append({
                    "start_ms": 0,
                    "end_ms": 0,
                    "word": entry["word"],
                    "phrase": entry["phrase"],
                })

        aligned = self._interpolate_gaps(aligned)
        return aligned

    def _interpolate_gaps(self, aligned: List[dict]) -> List[dict]:
        n = len(aligned)
        for i in range(n):
            if aligned[i]["start_ms"] > 0 or aligned[i]["end_ms"] > 0:
                continue

            prev_end = None
            for j in range(i - 1, -1, -1):
                if aligned[j]["end_ms"] > 0:
                    prev_end = aligned[j]["end_ms"]
                    break

            next_start = None
            for j in range(i + 1, n):
                if aligned[j]["start_ms"] > 0:
                    next_start = aligned[j]["start_ms"]
                    break

            if prev_end is not None and next_start is not None:
                chunk_size = (next_start - prev_end) / (
                    len([x for x in aligned if x["start_ms"] == 0 and x["end_ms"] == 0])
                    + 1
                )
                gap_count = 0
                for k in range(i, n):
                    if aligned[k]["start_ms"] == 0 and aligned[k]["end_ms"] == 0:
                        gap_count += 1
                        start = prev_end + int((gap_count) * chunk_size)
                        end = prev_end + int((gap_count + 1) * chunk_size)
                        aligned[k]["start_ms"] = start
                        aligned[k]["end_ms"] = end
                    else:
                        break
            elif prev_end is not None:
                aligned[i]["start_ms"] = prev_end
                aligned[i]["end_ms"] = prev_end + 100
            elif next_start is not None:
                aligned[i]["start_ms"] = max(0, next_start - 100)
                aligned[i]["end_ms"] = next_start
            else:
                aligned[i]["start_ms"] = 0
                aligned[i]["end_ms"] = 100

        return aligned

    def run(self, audio_path: str, lyrics_text: str) -> List[dict]:
        lyrics_entries = self.parse_lyrics(lyrics_text)
        whisper_words = self.transcribe(audio_path)
        aligned = self.align(lyrics_entries, whisper_words)
        return aligned

    def format_output(self, aligned: List[dict]) -> List[dict]:
        return [
            {
                "start_ms": w["start_ms"],
                "end_ms": w["end_ms"],
                "word": w["word"],
                "phrase": w["phrase"],
            }
            for w in aligned
        ]


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Lyric & Audio Forced-Alignment Tool")
    parser.add_argument("audio", help="Path to MP3 audio file")
    parser.add_argument("lyrics", help="Path to lyrics text file")
    parser.add_argument("--model", default="base", choices=["tiny", "base", "small", "medium", "large"],
                        help="Whisper model size (default: base)")
    parser.add_argument("--output", "-o", default=None, help="Output JSON file path")
    parser.add_argument("--cpu", action="store_true", help="Force CPU usage")

    args = parser.parse_args()

    if args.cpu:
        os.environ["FORCE_CPU"] = "1"

    with open(args.lyrics, "r", encoding="utf-8") as f:
        lyrics_text = f.read()

    aligner = LyricAligner(model_size=args.model)
    result = aligner.run(args.audio, lyrics_text)
    output = aligner.format_output(result)

    out_path = args.output or "aligned_output.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Alignment complete. Output saved to {out_path}")
    print(f"Total words aligned: {len(output)}")


if __name__ == "__main__":
    main()
