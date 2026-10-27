# TV Home

A custom home screen for a Samsung Smart TV (Tizen), built as a sideloaded app.
It replaces the cluttered default start experience with three things:

- a clean **home screen** — clock, date, weather and app shortcuts, no ads
- a **shared drawing board** that syncs live between the TV and any phone on the
  same Wi-Fi
- an **AI assistant** powered by Claude, answered on a small local server

Target hardware: Samsung UA43TU7000 (TU7000 Crystal UHD, Tizen 5.5). The TV app
is plain HTML/CSS/JS so it runs in the TV's older browser engine (Chromium 69):
no ES2019+ syntax, and flexbox `gap` / `aspect-ratio` are avoided.

## How it fits together

```
 Phone browser  ─┐
                 ├──  server.py (Mac)  ──  Claude API
 TV app (Tizen) ─┘     board sync + assistant
```

- `server.py` — a dependency-light Python HTTP server. Serves the pages, keeps
  the drawing board in sync over Server-Sent Events, and proxies the assistant
  so the API key never lives on the TV.
- `web/tv/` — the TV app. Remote-friendly: arrow-key spatial focus navigation,
  and drawing with the arrow keys as well as a pointer. `config.js` holds the
  weather location and the app-shortcut list.
- `web/phone/` — the phone drawing page (`/draw`), sized for touch.
- `web/shared/board.js` — the drawing/sync logic shared by both screens.
- `tizen/` + `build_wgt.sh` — package the app as a Tizen `.wgt` for sideloading.

## Run the server

```bash
python3 -m venv .venv
.venv/bin/pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...   # optional — without it the assistant is off
.venv/bin/python server.py
```

Then open **http://localhost:8787/tv/** in a browser to see the TV app, or
**http://<mac-ip>:8787/draw** on a phone to draw onto the board.

## Install on the TV (optional)

The TV app is a normal web page; the only Samsung-specific part is packaging and
sideloading it. `build_wgt.sh` copies `web/` into `build/`, points the app at the
Mac's IP, and — if Tizen Studio's CLI and a Samsung certificate profile are
present — signs and installs it over the network in Developer Mode.

## Notes

- Built and verified in a browser; the home screen, live phone↔TV drawing, and
  keyboard drawing all work. App tiles only launch other apps on the TV itself.
- No TV firmware is modified. The app is sideloaded through Samsung's official
  Developer Mode and sits alongside the built-in software.
