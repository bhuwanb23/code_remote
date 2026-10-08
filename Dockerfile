FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y curl wget git && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs

# Install OpenCode during build
RUN npm install -g opencode-ai@latest

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]