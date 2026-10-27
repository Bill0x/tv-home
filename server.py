"""TV Home server.

Runs on the Mac. Serves the TV app (for browser preview), the phone drawing
page, a live shared drawing board, and the Claude-powered assistant.

    .venv/bin/python server.py
"""

import json
import mimetypes
import os
import queue
import socket
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("TV_HOME_PORT", "8787"))
ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
BOARD_FILE = os.path.join(ROOT, "board.json")

MODEL = "claude-opus-5-5"
SYSTEM_PROMPT = (
    "You are the assistant built into a family's living-room TV. People read "
    "your replies from across the room, so keep answers short: a few sentences "
    "or a short list. Use plain text without markdown headings, tables or code "
    "blocks. Be warm and practical. Today is {today}."
)

# ---------------------------------------------------------------- drawing board

board_lock = threading.Lock()
board = []  # list of events: {"type": "seg", ...} pieces of strokes
listeners = []  # one queue per connected screen


def load_board():
    global board
    try:
        with open(BOARD_FILE) as f:
            board = json.load(f)
    except (OSError, ValueError):
        board = []


def save_board():
    tmp = BOARD_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(board, f)
    os.replace(tmp, BOARD_FILE)


def broadcast(event):
    for q in list(listeners):
        q.put(event)


def add_segment(data):
    pts = data.get("points")
    if not isinstance(pts, list) or not pts:
        raise ValueError("points required")
    seg = {
        "type": "seg",
        "sid": str(data.get("sid", ""))[:40],
        "color": str(data.get("color", "#ffffff"))[:20],
        "width": max(0.001, min(float(data.get("width", 0.006)), 0.1)),
        "points": [[float(p[0]), float(p[1])] for p in pts[:500]],
    }
    with board_lock:
        board.append(seg)
        save_board()
    broadcast(seg)


def clear_board():
    with board_lock:
        board.clear()
        save_board()
    broadcast({"type": "clear"})


# ---------------------------------------------------------------- assistant

chat_lock = threading.Lock()
chat_history = []
chat_started = None
_client = None


def get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()
    return _client


def ai_available():
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def reset_chat():
    global chat_started
    with chat_lock:
        chat_history.clear()
        chat_started = None


def ask_claude(text):
    """Send one user message; returns the reply text."""
    global chat_started
    import anthropic

    if not ai_available():
        return {"error": "The assistant isn't set up yet. Start the server with an ANTHROPIC_API_KEY."}

    with chat_lock:
        if chat_started is None:
            chat_started = datetime.now().strftime("%A, %d %B %Y")
        chat_history.append({"role": "user", "content": text})
        try:
            response = get_client().beta.messages.create(
                model=MODEL,
                max_tokens=16000,
                system=SYSTEM_PROMPT.format(today=chat_started),
                messages=chat_history,
                betas=["server-side-fallback-2026-07-01"],
                extra_body={"fallbacks": "default", "output_config": {"effort": "low"}},
            )
        except anthropic.AuthenticationError:
            chat_history.pop()
            return {"error": "The API key was rejected. Check ANTHROPIC_API_KEY."}
        except anthropic.RateLimitError:
            chat_history.pop()
            return {"error": "Too many requests right now. Try again in a minute."}
        except anthropic.APIStatusError as e:
            chat_history.pop()
            return {"error": "Claude returned an error ({}).".format(e.status_code)}
        except anthropic.APIConnectionError:
            chat_history.pop()
            return {"error": "Couldn't reach Claude. Check the Mac's internet connection."}

        if response.stop_reason == "refusal":
            chat_history.pop()
            return {"reply": "Sorry, I can't help with that one."}

        # Pass the content back unchanged on the next turn (thinking blocks included).
        chat_history.append({"role": "assistant", "content": [b.to_dict() for b in response.content]})
        reply = "".join(b.text for b in response.content if b.type == "text").strip()
        return {"reply": reply or "(no answer)"}


# ---------------------------------------------------------------- http


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.168.1.1", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


REDIRECTS = {
    "/": "/tv/",
    "/tv": "/tv/",
    "/draw": "/phone/",
    "/phone": "/phone/",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "TVHome/1.0"

    def log_message(self, fmt, *args):
        if "/api/board/stream" not in (args[0] if args else ""):
            print("  " + fmt % args)

    def cors(self):
        # The installed TV app runs from a file:// origin.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 1_000_000:
            raise ValueError("too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/status":
            return self.send_json({"ai": ai_available(), "ip": lan_ip(), "port": PORT})
        if path == "/api/board/stream":
            return self.stream_board()
        if path in REDIRECTS:
            self.send_response(302)
            self.send_header("Location", REDIRECTS[path])
            self.end_headers()
            return
        rel = path.lstrip("/")
        if rel.endswith("/"):
            rel += "index.html"
        self.serve_file(rel)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            data = self.read_json()
        except ValueError:
            return self.send_json({"error": "bad request"}, 400)
        if path == "/api/board/segment":
            try:
                add_segment(data)
            except (ValueError, TypeError, IndexError):
                return self.send_json({"error": "bad segment"}, 400)
            return self.send_json({"ok": True})
        if path == "/api/board/clear":
            clear_board()
            return self.send_json({"ok": True})
        if path == "/api/assistant":
            text = str(data.get("message", "")).strip()[:4000]
            if not text:
                return self.send_json({"error": "empty message"}, 400)
            return self.send_json(ask_claude(text))
        if path == "/api/assistant/reset":
            reset_chat()
            return self.send_json({"ok": True})
        self.send_json({"error": "not found"}, 404)

    def serve_file(self, rel):
        full = os.path.realpath(os.path.join(WEB, rel))
        if not full.startswith(os.path.realpath(WEB) + os.sep) or not os.path.isfile(full):
            return self.send_json({"error": "not found"}, 404)
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(full)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def stream_board(self):
        """Server-sent events: the whole board first, then live updates."""
        q = queue.Queue()
        with board_lock:
            snapshot = list(board)
            listeners.append(q)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.cors()
            self.end_headers()
            self.wfile.write(("data: " + json.dumps({"type": "snapshot", "events": snapshot}) + "\n\n").encode())
            self.wfile.flush()
            while True:
                try:
                    event = q.get(timeout=15)
                    chunk = "data: " + json.dumps(event) + "\n\n"
                except queue.Empty:
                    chunk = ": ping\n\n"
                self.wfile.write(chunk.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            listeners.remove(q)


def main():
    load_board()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    ip = lan_ip()
    print("TV Home server running")
    print("  TV app preview:   http://{}:{}/".format(ip, PORT))
    print("  Phone drawing:    http://{}:{}/draw".format(ip, PORT))
    print("  (if macOS asks whether Python may accept incoming connections, click Allow)")
    print("  Assistant:        {}".format("ready" if ai_available() else "off (no ANTHROPIC_API_KEY)"))
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
