// Settings for the TV app. build_wgt.sh rewrites `server` for the installed app.
window.TV_CONFIG = {
  // Address of the Mac running server.py. Empty = same address as this page (browser preview).
  server: "",
  // Weather on the home screen, e.g. { name: "Dubai", lat: 25.2, lon: 55.27 }. null hides it.
  weather: null,
  // Apps on the "Watch" row. Tizen app IDs; remove any you don't use.
  apps: [
    { name: "YouTube", id: "111299001912", color: "#ff0033" },
    { name: "Netflix", id: "3201907018807", color: "#e50914" },
    { name: "Prime Video", id: "3201910019365", color: "#1a98ff" },
    { name: "Disney+", id: "3201901017640", color: "#113ccf" },
    { name: "Spotify", id: "3201606009684", color: "#1db954" }
  ]
};
