#!/bin/bash

# Download latest OpenCode AppImage
wget -O /opt/opencode/opencode.AppImage \
"https://YOUR_OPENCODE_RELEASE_URL"

chmod +x /opt/opencode/opencode.AppImage

# Start OpenCode
/opt/opencode/opencode.AppImage &

# Keep desktop alive
/usr/bin/supervisord -c /etc/supervisor/supervisord.conf