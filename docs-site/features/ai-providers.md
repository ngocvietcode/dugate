# AI Providers

dugate supports three AI Vision providers. You can switch between them from the **Settings** page — no server restart needed.

## Supported Providers

### Google Gemini

| Setting | Value |
|---|---|
| Get API key | [aistudio.google.com](https://aistudio.google.com/) |
| Recommended model | `gemini-1.5-flash` |
| Notes | Fast and cost-effective. Default provider. |

### OpenAI

| Setting | Value |
|---|---|
| Get API key | [platform.openai.com](https://platform.openai.com/) |
| Recommended model | `gpt-4o` |
| Notes | Strong vision capability. Higher cost than Gemini. |

### Anthropic

| Setting | Value |
|---|---|
| Get API key | [console.anthropic.com](https://console.anthropic.com/) |
| Recommended model | `claude-3-5-sonnet-20241022` |
| Notes | Best for complex document understanding. |

## Security

API keys entered in the Settings UI are **encrypted with AES-256** before being stored in the database. The `ENCRYPTION_KEY` env var (32 chars) is used as the encryption key.

Keys set via environment variable (`GEMINI_API_KEY`) take precedence over UI-entered keys for Gemini.

## Switching Providers

1. Go to **Settings** (`/settings`)
2. Select a provider from the dropdown
3. Enter your API key
4. Click **Save**
5. Test the connection with the **Test** button

Changes take effect immediately — ongoing transformations are not affected.

## Custom Prompts

You can customize the prompt sent to the AI in Settings. Two presets are available:

- **English** — outputs image descriptions and Markdown in English
- **Vietnamese** — outputs in Vietnamese (`tiếng Việt`)

Or write your own prompt for domain-specific terminology.
