"""Generate neural Mandarin narration via edge-tts. JSON in, MP3 bytes out."""

import asyncio
import json
import sys

import edge_tts


async def main():
    request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    speech = edge_tts.Communicate(
        request["text"],
        voice=request["voice"],
        rate=f'{request["rate"]:+d}%',
    )
    async for chunk in speech.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
