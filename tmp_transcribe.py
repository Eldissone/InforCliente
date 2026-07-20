import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel

VIDEO = Path(r"c:\Users\Evilonga\Downloads\reunia BG PP.mp4")
OUT = Path(r"c:\Users\Evilonga\InforCliente\tmp_transcribe_output.json")

def main():
    print("Loading model...", flush=True)
    model = WhisperModel("small", device="cpu", compute_type="int8")

    print("Transcribing...", flush=True)
    segments, info = model.transcribe(
        str(VIDEO),
        language="pt",
        beam_size=5,
        vad_filter=True,
    )

    rows = []
    full_text = []
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        row = {
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": text,
        }
        rows.append(row)
        full_text.append(text)
        print(f"[{row['start']:>7.1f}s - {row['end']:>7.1f}s] {text}", flush=True)

    payload = {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 2) if info.duration else None,
        "segments": rows,
        "full_text": " ".join(full_text),
    }

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved to {OUT}", flush=True)

if __name__ == "__main__":
    main()
