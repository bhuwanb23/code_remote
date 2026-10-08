FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y curl wget git

RUN wget https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64 \
    -O /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]