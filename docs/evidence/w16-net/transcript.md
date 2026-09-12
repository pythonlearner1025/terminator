# W16 netcode evidence

- Run: headless Chromium with two isolated browser contexts on Kite3D dev port 4590.
- Relay: ws://127.0.0.1:7816, real WebSocket lobby server.
- Host: wave 1, tick 119, players John, Sarah, 1 remote soldier visual.
- Guest: wave 1, tick 118, players John, Sarah, 1 remote soldier visual.
- Host message counts: {"sent":{"welcome":1,"party_state":4,"event":7,"start":1,"snapshot":40},"received":{"relay_ready":1,"peer_join":1,"join":1,"ready":1,"input":2}}.
- Guest message counts: {"sent":{"join":1,"ready":1,"input":2},"received":{"relay_ready":1,"welcome":1,"party_state":4,"event":7,"start":1,"snapshot":40}}.
- Snapshot measurement: 40 samples at 21.00 Hz.
- Browser errors: 0.
- Screenshots: host-wave1.png and guest-wave1.png.
