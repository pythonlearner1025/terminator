# Terminator Skynet reference client

Run against a lobby code shown by the game:

```sh
ANTHROPIC_API_KEY=... npx terminator-skynet-client --url http://localhost:7801 --code ABC123
```

The model id comes from `SKYNET_MODEL` and defaults to `claude-sonnet-5`. For a deterministic local
loop that needs no key, add `--fake`.
