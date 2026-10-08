FROM dorowu/ubuntu-desktop-lxde-vnc

USER root

RUN apt-get update && \
    apt-get install -y wget curl git

# Download OpenCode desktop
# Replace URL with actual release URL
RUN mkdir -p /opt/opencode

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]