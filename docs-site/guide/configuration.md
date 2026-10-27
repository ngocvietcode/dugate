# Configuration

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/dugate` |
| `NEXTAUTH_SECRET` | Yes | Random string ≥ 32 chars. Generate: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes | Your app URL, e.g. `http://localhost:2023` |
| `ENCRYPTION_KEY` | Yes | Exactly 32 characters. Used to encrypt API keys in DB |
| `GEMINI_API_KEY` | No | Google AI Studio key. Can also be set in the Settings UI |
| `UPLOAD_DIR` | No | Default: `./uploads` |
| `OUTPUT_DIR` | No | Default: `./outputs` |

## AI Providers

You can switch providers any time from the **Settings** page without restarting the server.

### Google Gemini

Get an API key from [Google AI Studio](https://aistudio.google.com/).

Supported models:
- `gemini-1.5-flash` (fast, recommended)
- `gemini-1.5-pro` (higher quality)

### OpenAI

Get an API key from [platform.openai.com](https://platform.openai.com/).

Supported models:
- `gpt-4o`
- `gpt-4o-mini`

### Anthropic

Get an API key from [console.anthropic.com](https://console.anthropic.com/).

Supported models:
- `claude-3-5-sonnet-20241022`
- `claude-3-haiku-20240307`

## AI Prompts

The default prompt instructs the AI to describe images in detail and transform document structure to clean Markdown.

You can customize the prompt in **Settings** or choose a preset:

| Preset | Language |
|---|---|
| English (default) | English output |
| Vietnamese | Vietnamese output (tiếng Việt) |

## Auto Cleanup

Files in `uploads/` and `outputs/` are automatically deleted after **24 hours**. The cleanup scheduler runs every 6 hours in the background.

To disable or adjust, modify `lib/cleanup-scheduler.ts`.
