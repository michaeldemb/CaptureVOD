# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app
COPY . .
VOLUME /data
EXPOSE 8080 8022 8021 50200-50250
CMD ["node","server/index.js"]
