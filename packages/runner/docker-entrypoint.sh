#!/bin/sh
set -e

# Named Docker volumes are created owned by root. Fix ownership of the two
# runtime volumes so the non-root 'runner' user (UID 1000) can write to them.
# This runs as root (ENTRYPOINT is before USER in execution order when the
# entrypoint is set in the image and USER is dropped inside it via su).
chown -R runner:runner /scripts /artifacts 2>/dev/null || true

# Drop from root to the 'runner' user and start the Node server.
exec su -s /bin/sh runner -c 'exec node --max-old-space-size=512 packages/runner/src/index.js'
