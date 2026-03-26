# weixin-claw-cli

A command-line tool for sending and receiving WeChat messages directly from your terminal.

## Quick Start

```bash
npm install -g weixin-claw-cli
weixin login
```

Or use without installing:

```bash
npx weixin-claw-cli login
```

## Features

- QR code login directly in terminal
- Send text messages and clipboard content to WeChat
- Send files, images, and videos
- Listen for incoming messages in real-time
- Interactive chat mode
- Auto-login when no account is found
- Works with both Node.js (>=18) and Bun

## Commands

| Command | Description |
|---------|-------------|
| `weixin` | Send clipboard content to your bound WeChat |
| `weixin login` | Scan QR code to login |
| `weixin accounts` | List logged-in accounts |
| `weixin send <user_id> <message>` | Send a text message |
| `weixin sendfile <file> [options]` | Send a file, image, or video |
| `weixin listen` | Listen and print incoming messages |
| `weixin chat [user_id]` | Interactive two-way chat |
| `weixin help` | Show help |

## Usage Examples

### Send clipboard content (default)

```bash
# Copy something, then:
weixin
```

### Send a text message

```bash
weixin send "user123@im.wechat" "Hello from terminal!"
```

### Send files

```bash
# Send an image to yourself
weixin sendfile photo.jpg

# Send a file to a specific user
weixin sendfile report.pdf --to "user123@im.wechat"

# Send with a caption
weixin sendfile demo.mp4 --caption "Check this out"
```

Supported file types are auto-detected by extension:

| Type | Extensions |
|------|-----------|
| Image | jpg, png, gif, webp, bmp |
| Video | mp4, mov, webm, avi |
| File | pdf, doc, xls, zip, and more |

### Listen for messages

```bash
weixin listen
```

### Interactive chat

```bash
# Auto-detect chat target from first incoming message
weixin chat

# Or specify a target
weixin chat "user123@im.wechat"
```

In chat mode:
- Type a message and press Enter to send
- `/target <id>` to switch chat target
- `/quit` to exit

## Data Storage

Credentials and session data are stored in `~/.weixin/`.

## Development

```bash
# Install dependencies
bun install

# Run in dev mode
bun run dev

# Build for distribution
bun run build
```

## License

MIT
