#!/usr/bin/env bash
# Start Nnoel with Docker Compose — pulls the prebuilt image (docker-compose.yml)
set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check that Docker is installed
if ! command -v docker &>/dev/null; then
  echo -e "${RED}Error: Docker is not installed.${NC}"
  echo ""
  echo "Install it for your distribution:"
  echo ""
  echo "  Ubuntu / Debian:"
  echo "    sudo apt update && sudo apt install -y docker.io"
  echo "    sudo systemctl enable --now docker"
  echo ""
  echo "  Fedora:"
  echo "    sudo dnf install -y docker"
  echo "    sudo systemctl enable --now docker"
  echo ""
  echo "  Arch Linux:"
  echo "    sudo pacman -S docker"
  echo "    sudo systemctl enable --now docker"
  echo ""
  echo "  openSUSE:"
  echo "    sudo zypper install -y docker"
  echo "    sudo systemctl enable --now docker"
  echo ""
  echo "Then re-run this script."
  exit 1
fi

# Check that the Docker daemon is running and accessible
if ! docker info &>/dev/null; then
  echo -e "${RED}Error: Cannot connect to Docker daemon.${NC}"
  echo ""
  echo "If the daemon is not running, start it:"
  echo "  sudo systemctl start docker"
  echo ""
  echo "If you lack permissions, add your user to the docker group:"
  echo "  sudo usermod -aG docker $USER"
  echo "  (then log out and back in)"
  exit 1
fi

# Detect Docker Compose v2 (plugin) vs v1 (standalone binary)
if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  echo -e "${YELLOW}Using 'docker-compose' (consider upgrading to Compose v2).${NC}"
  COMPOSE="docker-compose"
else
  echo -e "${RED}Error: Docker Compose not found.${NC}"
  echo "Install it: https://docs.docker.com/compose/install/"
  exit 1
fi

echo "Starting Nnoel..."
$COMPOSE up
