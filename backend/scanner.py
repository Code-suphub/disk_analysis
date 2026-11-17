import os
import json
import time
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Union

class DiskScanner:
    def __init__(self):
        self.system = platform.system()

    def get_disk_info(self) -> List[Dict]:
        """获取所有挂载磁盘的使用情况"""
        disks = []
        try:
            if self.system == "Windows":
                import ctypes
                bitmask = ctypes.windll.kernel32.GetLogicalDrives()
                for i in range(26):
                    if bitmask & (1 << i):
                        drive = f"{chr(65 + i)}:\\"
                        try:
                            abs_path = str(Path(drive).resolve())
                            usage = shutil.disk_usage(drive)
                            disks.append({
                                'path': abs_path,
                                'name': f"本地磁盘 ({drive[0]})",
                                'total': usage.total,
                                'used': usage.used,
                                'free': usage.free,
                                'percent': round((usage.used / usage.total) * 100, 2)
                            })
                        except:
                            continue
            else:
                try:
                    # 使用 df -Pk 保持 POSIX 输出格式，列索引固定
                    output = subprocess.check_output(['df', '-Pk']).decode('utf-8').splitlines()
                    seen_devices = set()
                    for line in output[1:]:
                        parts = line.split()
                        if len(parts) >= 6:
                            device = parts[0]
                            path = parts[5]
                            
                            # 1. 过滤掉非本地物理磁盘 (devfs, map, etc.)
                            if not device.startswith('/dev/disk'):
                                continue
                                
                            # 2. 过滤 macOS 内部系统卷
                            # 我们只想保留 / (系统) 和 /System/Volumes/Data (用户数据)
                            # 以及 /Volumes/* (外接盘)
                            is_main_root = (path == "/")
                            is_user_data = ("/Volumes/Data" in path or path == "/System/Volumes/Data")
                            is_external = path.startswith("/Volumes/") and not path.startswith("/Volumes/Data")
                            
                            if not (is_main_root or is_user_data or is_external):
                                continue
                            
                            # 3. 避免同一个路径重复显示
                            if path in seen_devices:
                                continue
                            
                            try:
                                abs_path = str(Path(path).resolve())
                                usage = shutil.disk_usage(path)
                                
                                # 优化显示名称
                                if path == "/":
                                    name = "系统盘 (/)"
                                elif "Data" in path:
                                    name = "用户数据盘 (Data) - ⭐ 推荐扫描"
                                else:
                                    name = f"磁盘 ({os.path.basename(path)})"

                                disks.append({
                                    'path': abs_path,
                                    'name': name,
                                    'total': usage.total,
                                    'used': usage.used,
                                    'free': usage.free,
                                    'percent': round((usage.used / usage.total) * 100, 2)
                                })
                                seen_devices.add(path)
                            except:
                                continue
                except:
                    usage = shutil.disk_usage("/")
                    disks.append({
                        'path': "/",
                        'name': "根目录",
                        'total': usage.total,
                        'used': usage.used,
                        'free': usage.free,
                        'percent': round((usage.used / usage.total) * 100, 2)
                    })
        except Exception as e:
            pass
        return disks

    def get_dir_size_fast(self, path: str) -> int:
        """极速获取文件夹大小"""
        try:
            if self.system != "Windows":
                # 使用 Popen 以捕获 stderr
                process = subprocess.Popen(
                    ['du', '-sk', path],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )
                stdout, stderr = process.communicate(timeout=5)

                if stderr and ("Permission denied" in stderr or "Not permitted" in stderr):
                    # 发送权限受限消息给前端
                    print(json.dumps({'type': 'status', 'message': f'权限受限: {os.path.basename(path)}'}), flush=True)

                if stdout:
                    return int(stdout.split()[0]) * 1024
        except subprocess.TimeoutExpired:
            print(json.dumps({'type': 'status', 'message': f'计算超时: {os.path.basename(path)}'}), flush=True)
            return 0
        except Exception as e:
            print(json.dumps({'type': 'status', 'message': f'计算错误: {os.path.basename(path)} - {str(e)}'}), flush=True)
            return 0
        return 0

    def list_directory_details_streaming(self, root_path: str):
        """流式列出目录内容"""
        try:
            root_path_abs = str(Path(root_path).resolve())

            # macOS 特殊处理：扫描 / 时，实际应该扫描 /System/Volumes/Data
            # 因为用户数据实际存储在 Data 卷
            is_macos_root = (self.system == "Darwin" and root_path_abs == "/")
            data_volume_path = "/System/Volumes/Data"

            # 如果是 macOS 根目录，自动重定向到数据卷（避免权限问题）
            if is_macos_root and os.path.exists(data_volume_path):
                print(json.dumps({'type': 'status', 'message': '检测到 macOS 系统，自动切换到用户数据卷（无需管理员权限）'}), flush=True)
                root_path_abs = data_volume_path

            entries = []

            # 扫描目录
            try:
                with os.scandir(root_path_abs) as it:
                    for entry in it:
                        try:
                            info = {
                                'name': entry.name,
                                'path': str(Path(entry.path).resolve()),
                                'is_dir': entry.is_dir(),
                                'type': 'directory' if entry.is_dir() else 'file',
                                'size': entry.stat(follow_symlinks=False).st_size if not entry.is_dir() else 0
                            }
                            entries.append(info)
                        except (PermissionError, OSError):
                            continue
            except (PermissionError, OSError) as e:
                print(json.dumps({'type': 'status', 'message': f'警告: 无法访问 {root_path_abs}: {str(e)}'}), flush=True)

            # 1. 立即返回基础结构
            print(json.dumps({
                'type': 'structure',
                'root': root_path_abs,
                'items': entries
            }), flush=True)

            # 2. 获取根目录及其直接子目录的大小
            size_map = {}
            if self.system != "Windows":
                try:
                    # 使用 du -d 1 -k 获取当前层级所有子项大小
                    output = subprocess.check_output(['du', '-d', '1', '-k', root_path_abs], timeout=20, stderr=subprocess.DEVNULL).decode('utf-8')
                    root_size = 0
                    for line in output.splitlines():
                        parts = line.split('\t')
                        if len(parts) == 2:
                            # 规范化路径以匹配
                            p = str(Path(parts[1]).resolve())
                            size = int(parts[0]) * 1024
                            size_map[p] = size
                            # 第一行是根目录本身
                            if p == root_path_abs:
                                root_size = size

                    if size_map:
                        print(json.dumps({
                            'type': 'size_batch',
                            'sizes': size_map,
                            'root_size': root_size
                        }), flush=True)
                        return
                except Exception as e:
                    print(json.dumps({'type': 'status', 'message': f'批量计算失败，使用回退方案: {str(e)}'}, flush=True))

            # 3. 回退方案：逐个计算并发送
            # 首先计算根目录大小
            root_size = 0
            for entry in entries:
                if entry['is_dir']:
                    print(json.dumps({'type': 'status', 'message': f"正在计算: {entry['name']}"}), flush=True)
                    size = self.get_dir_size_fast(entry['path'])
                    if size == 0: # 如果 fast 失败，尝试基本扫描
                        try:
                            with os.scandir(entry['path']) as it2:
                                for e2 in it2:
                                    if e2.is_file(follow_symlinks=False):
                                        size += e2.stat(follow_symlinks=False).st_size
                        except: pass

                    root_size += size
                    print(json.dumps({
                        'type': 'size_update',
                        'path': entry['path'],
                        'size': size
                    }), flush=True)
                else:
                    root_size += entry['size']

            # 发送根目录最终大小
            print(json.dumps({
                'type': 'size_update',
                'path': root_path_abs,
                'size': root_size
            }), flush=True)

        except Exception as e:
            print(json.dumps({'type': 'error', 'message': str(e)}), flush=True)

if __name__ == "__main__":
    import sys
    scanner = DiskScanner()
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "disk_info":
            print(json.dumps(scanner.get_disk_info()))
        elif cmd == "list_dir" and len(sys.argv) > 2:
            scanner.list_directory_details_streaming(sys.argv[2])
        else:
            scanner.list_directory_details_streaming(sys.argv[1])
    else:
        print(json.dumps(scanner.get_disk_info()))
