#!/bin/sh
set -e

# 启动虚拟显示服务器Xvfb
Xvfb :99 -screen 0 1024x768x16 &

# 等待Xvfb启动
sleep 1

# 启动窗口管理器
fluxbox -display :99 &

# 启动VNC服务器，允许远程访问图形界面
x11vnc -forever -usepw -create -display :99 &

# 设置VNC密码（第一次运行时）
mkdir -p $HOME/.vnc
echo "diskanalyzer" | x11vnc -storepasswd stdin $HOME/.vnc/passwd

# 运行Electron应用
# 对于开发模式使用：npm run dev
# 对于生产环境使用构建好的应用
if [ "$1" = "dev" ]; then
  echo "启动开发模式..."
  exec npm run dev
else
  echo "启动生产模式..."
  # 根据构建的可执行文件路径执行
  # 这里假设electron-builder默认输出在dist目录
  # 具体路径可能需要根据electron-builder的配置调整
  if [ -d "./dist/linux-unpacked" ]; then
    ./dist/linux-unpacked/disk-space-analyzer
  elif [ -d "./dist" ]; then
    # 尝试使用预构建的二进制文件
    find ./dist -type f -name "*-unpacked" -o -name "*.AppImage" -o -name "*.app" | xargs -I {} sh -c 'if [ -x "{}" ]; then echo "Running {}"; exec "{}"; fi'
  else
    echo "错误: 找不到构建文件，运行开发模式..."
    npm run dev
  fi
  
  # 保持容器运行
  tail -f /dev/null
fi 