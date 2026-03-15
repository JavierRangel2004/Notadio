import argparse
import json
import os
import sys
import traceback


def load_diarize_runner():
    try:
        import diarize as diarize_module
    except Exception as exc:
        print("Error: failed to import the 'diarize' package.", file=sys.stderr)
        print(f"  Python executable: {sys.executable}", file=sys.stderr)
        print(f"  Python path: {sys.path}", file=sys.stderr)
        print(f"  Import error: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        print(
            "Please run scripts/setup-diarization.sh and ensure DIARIZATION_COMMAND points to the venv python.",
            file=sys.stderr,
        )
        sys.exit(1)

    if hasattr(diarize_module, "Diarizer"):
        diarizer_class = diarize_module.Diarizer

        def run_diarization(audio_path):
            diarizer = diarizer_class()
            return diarizer.diarize(audio_path)

        return run_diarization

    if hasattr(diarize_module, "diarize"):
        diarize_fn = diarize_module.diarize

        def run_diarization(audio_path):
            result = diarize_fn(audio_path)
            return getattr(result, "segments", result)

        return run_diarization

    print("Error: Unsupported 'diarize' package API.", file=sys.stderr)
    print(
        f"  Available exports: {sorted(name for name in dir(diarize_module) if not name.startswith('_'))}",
        file=sys.stderr,
    )
    sys.exit(1)


def normalize_segment(segment):
    if isinstance(segment, dict):
        speaker = segment.get("speaker") or segment.get("label")
        start = segment.get("start")
        end = segment.get("end")
    else:
        speaker = getattr(segment, "speaker", None) or getattr(segment, "label", None)
        start = getattr(segment, "start", None)
        end = getattr(segment, "end", None)

    if speaker is None or start is None or end is None:
        raise ValueError(f"Unsupported diarization segment payload: {segment!r}")

    return {
        "speaker": str(speaker),
        "start": float(start),
        "end": float(end),
    }

def main():
    parser = argparse.ArgumentParser(description="CPU-only Speaker Diarization for Notadio using diarize library")
    parser.add_argument("--input", required=True, help="Path to input audio/video file")
    parser.add_argument("--output", required=True, help="Path to output JSON file")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: Input file does not exist: {args.input}", file=sys.stderr)
        sys.exit(1)

    run_diarization = load_diarize_runner()

    print(f"Loading diarization models (this may download weights on first run)...", file=sys.stderr)

    print(f"Processing audio: {args.input}", file=sys.stderr)
    sys.stderr.flush()

    try:
        results = run_diarization(args.input)
        formatted_segments = [normalize_segment(segment) for segment in results]

        print(f"Diarization complete. Found {len(formatted_segments)} segments.", file=sys.stderr)

        # Ensure output directory exists
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(formatted_segments, f, ensure_ascii=False, indent=2)

    except Exception as e:
        print(f"Diarization process failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
