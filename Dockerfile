FROM kasmweb/core-ubuntu-focal:1.16.0

USER root

RUN rm -f /etc/apt/sources.list.d/google-chrome.list || true && \
    apt-get update && \
    apt-get install -y wget curl git

# Download OpenCode desktop
# Replace URL with actual release URL
RUN mkdir -p /opt/opencode

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]