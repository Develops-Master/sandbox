# La imagen ya trae su propio Node.js (22): el servidor donde la subas solo necesita Docker, no tiene que instalar Node.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js index.html three.min.js GLTFLoader.js SkeletonUtils.js TransformControls.js csg.js prim.js ./
COPY models ./models
ENV PORT=3001 DATA_DIR=/data NODE_ENV=production
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1
CMD ["node", "server.js"]
