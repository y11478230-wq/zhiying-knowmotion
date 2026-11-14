"""Generate neural Mandarin narration via edge-tts. JSON in, MP3 bytes out."""

import asyncio
import json
import sys

import edge_tts


async def main():
    request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    timings = []
    speech = edge_tts.Communicate(
        request["text"],
        voice=request["voice"],
        rate=f'{request["rate"]:+d}%',
        boundary="SentenceBoundary",
    )
    async for chunk in speech.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
        elif chunk["type"] == "SentenceBoundary":
            timings.append({"offset": chunk["offset"], "duration": chunk["duration"], "text": chunk["text"]})
    sys.stdout.buffer.flush()
    # Keep the side channel ASCII-only so Windows code pages cannot replace
    # Chinese sentence text with question marks before Node parses it.
    sys.stderr.write("__CAPTION_TIMINGS__" + json.dumps(timings, ensure_ascii=True) + "\n")
    sys.stderr.flush()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
