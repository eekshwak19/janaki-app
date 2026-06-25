import asyncio
import edge_tts
import sys

def generate_peer_response(text, rate="+0%"):
    async def _synthesize():
        communicate = edge_tts.Communicate(text, "en-US-JennyNeural", rate=rate)
        audio_bytes = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_bytes += chunk["data"]
        return audio_bytes

    return asyncio.run(_synthesize())

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python tts_service.py <text> <output_path> [rate]")
        sys.exit(1)
        
    text_to_speak = sys.argv[1]
    output_file_path = sys.argv[2]
    rate = sys.argv[3] if len(sys.argv) > 3 else "+0%"
    
    try:
        audio_data = generate_peer_response(text_to_speak, rate)
        with open(output_file_path, "wb") as f:
            f.write(audio_data)
        print(f"Success: Generated audio at {output_file_path}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
