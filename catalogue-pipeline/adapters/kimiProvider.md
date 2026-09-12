# Kimi provider adapter

`createKimiProvider()` provides maintainer-side access to Moonshot's OpenAI-compatible Chat Completions interface. Its default base URL is `https://api.moonshot.ai/v1`; `KIMI_BASE_URL` or the explicit `endpointBaseUrl` option may override it. The adapter requires an explicit model ID and reads credentials from `KIMI_API_KEY` by default.

The adapter requests JSON-object output and relies on Movie Mood's existing local semantic validator as the authority. Thinking behavior is explicit: `default` sends no override, while `disabled` sends `{ "thinking": { "type": "disabled" } }`. The selected mode is included in output-affecting provider identity.

Kimi has not been live-calibrated. Gemini 3.6 Flash remains the validated semantic production provider, and no production provider switch or live-launcher integration is included here.
