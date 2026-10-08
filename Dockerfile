FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y \
    curl \
    wget \
    git \
    unzip \
    build-essential \
    nodejs \
    npm \
    openssh-server \
    && rm -rf /var/lib/apt/lists/*

# Install ttyd (Web Terminal)
RUN wget -O /tmp/ttyd.tar.gz https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64
RUN chmod +x /tmp/ttyd.tar.gz && mv /tmp/ttyd.tar.gz /usr/local/bin/ttyd

WORKDIR /workspace

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]