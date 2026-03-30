#!/usr/bin/env bash
set -e

# Context Paging — start script
# Installs the required provider SDK and starts the agent

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Load .env if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

PROVIDER="${AI_PROVIDER:-anthropic}"

# Map provider to npm package
case "$PROVIDER" in
  anthropic)      PACKAGE="@ai-sdk/anthropic" ;;
  openai)         PACKAGE="@ai-sdk/openai" ;;
  google)         PACKAGE="@ai-sdk/google" ;;
  mistral)        PACKAGE="@ai-sdk/mistral" ;;
  xai)            PACKAGE="@ai-sdk/xai" ;;
  amazon-bedrock) PACKAGE="@ai-sdk/amazon-bedrock" ;;
  azure)          PACKAGE="@ai-sdk/azure" ;;
  *)
    echo "Error: Unknown provider '$PROVIDER'"
    echo "Supported: anthropic | openai | google | mistral | xai | amazon-bedrock | azure"
    exit 1
    ;;
esac

echo "Provider: $PROVIDER"
echo "Package:  $PACKAGE"
echo ""

# Install provider package if not already installed
if [ ! -d "node_modules/$PACKAGE" ]; then
  echo "Installing $PACKAGE..."
  npm install "$PACKAGE"
  echo ""
fi

# Build if needed
if [ ! -d "build" ] || [ "$(find src -newer build/index.js -name '*.ts' 2>/dev/null | head -1)" ]; then
  echo "Building..."
  npm run build
  echo ""
fi

# Start the agent
exec node build/index.js
