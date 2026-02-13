# Docker 使用说明

本项目提供了Docker支持，可以在Windows、macOS或Linux上运行，而无需安装任何依赖。

## 前提条件

- 安装并启动 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- 如果需要图形界面，安装VNC客户端 (如 [VNC Viewer](https://www.realvnc.com/en/connect/download/viewer/))

## 使用方法

### 构建并运行容器

1. 构建并启动容器：

```bash
docker-compose up -d
```

2. 连接到应用程序图形界面：
   - 打开VNC客户端（如VNC Viewer）
   - 连接到 `localhost:5900`
   - 输入密码：`diskanalyzer`

### 访问目录

默认配置允许容器访问：

- macOS/Linux:
  - 整个根目录 (`/` 挂载为 `/host`)
  - 用户目录 (`/Users` 或 `/home`)
  - 额外挂载的卷 (`/Volumes`)

- Windows (需取消注释相关行):
  - C盘 (作为 `/C`)
  - D盘 (作为 `/D`)
  - 可根据需要添加更多磁盘

### 自定义挂载目录

可根据需要修改`docker-compose.yml`中的volumes部分：

```yaml
volumes:
  # macOS挂载
  - /:/host:ro
  - /Volumes:/Volumes:ro
  - /Users:/Users:ro
  
  # Windows挂载（取消注释使用）
  # - /host_mnt/c:/C:ro  # C盘
  # - /host_mnt/d:/D:ro  # D盘
  # - /host_mnt/e:/E:ro  # 添加更多驱动器
```

在Windows主机上运行时，需取消注释对应的Windows挂载点。

### 开发模式

如果要在开发模式下运行应用，请修改`docker-compose.yml`：

```yaml
# 取消以下行的注释
command: dev
```

## 注意事项

1. Docker必须先启动才能构建和运行容器
2. 默认VNC密码为"diskanalyzer"，可在docker-entrypoint.sh中修改
3. VNC连接未加密，仅适用于本地使用或安全网络环境
4. 在Windows系统上使用时，需要在docker-compose.yml中取消注释相应的Windows卷挂载行 