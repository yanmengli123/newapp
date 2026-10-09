FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG VITE_API_BASE=
ARG VITE_BLAST_BASE=/blast-service
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_BLAST_BASE=$VITE_BLAST_BASE
RUN npm run build

FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
