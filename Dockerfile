FROM node:lts-alpine

# 安装基本工具和依赖
RUN apk add --no-cache \
    python3 \
    py3-pip \
    bash \
    xvfb-run \
    x11vnc \
    fluxbox \
    xvfb

# 创建工作目录
WORKDIR /app

# 复制应用文件
COPY package*.json ./
COPY requirements.txt ./

# 安装Node.js和Python依赖
RUN npm ci
RUN pip3 install -r requirements.txt || echo "Skipping Python deps"

# 复制源代码
COPY . .

# 设置环境变量
ENV DISPLAY=:99
ENV HOME=/root
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# 构建应用
RUN npm run build

# 启动脚本
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"] 