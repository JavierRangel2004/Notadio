#!/usr/bin/env bash
set -e

echo "Setting up Notadio local diarization environment..."

# Go to project root
cd "$(dirname "$0")/.."

# Create .local directory if it doesn't exist
mkdir -p .local

# Set up the virtual environment
VENV_DIR=".local/diarize-venv"

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment in $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
else
    echo "Virtual environment already exists in $VENV_DIR. Skipping creation."
fi

# Activate the virtual environment
source "$VENV_DIR/bin/activate"

# Upgrade pip and install the diarize library
echo "Installing diarize library..."
pip install --upgrade pip
pip install diarize

# Verify installation
echo "Verifying installation..."
python -c "from diarize import diarize; print('diarize library installed successfully.')" || {
    echo "Failed to install diarize library."
    exit 1
}

echo ""
echo "==========================================="
echo "Diarization environment setup complete!"
echo ""
echo "To enable diarization, make sure your .env file includes:"
echo 'DIARIZATION_COMMAND=./.local/diarize-venv/bin/python'
echo 'DIARIZATION_ARGS="{projectRoot}/scripts/diarize_audio.py" --input "{input}" --output "{outputFile}"'
echo "==========================================="
