FROM node:24-slim

WORKDIR /app

# 의존성 먼저 설치해 레이어 캐시를 활용한다.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 클라이언트를 정적 파일로 빌드하면 Express가 client/dist를 서빙한다.
RUN npm run build

ENV NODE_ENV=production
ENV API_PORT=8080
# DATABASE_URL / JWT_SECRET 은 배포 시 비밀 값으로 주입한다.

EXPOSE 8080

CMD ["npm", "start"]
