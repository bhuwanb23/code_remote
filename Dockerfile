FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    nodejs \
    npm

RUN npm install -g opencode-ai@latest

RUN apt-get install -y ttyd

EXPOSE 10000

CMD ttyd --writable -p ${PORT:-10000} bash