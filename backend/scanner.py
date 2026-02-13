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
                    output = subprocess.check_output(['df', '-Pk']).decode('utf-8').splitlines()
                    for line in output[1:]:
                        parts = line.split()
                        if len(parts) >= 6:
                            path = parts[5]
                            if not path.startswith(('/proc', '/sys', '/dev', '/run')) or path == '/':
                                try:
                                    abs_path = str(Path(path).resolve())
                                    usage = shutil.disk_usage(path)
                                    disks.append({
                                        'path': abs_path,
                                        'name': os.path.basename(path) or "/",
                                        'total': usage.total,
                                        'used': usage.used,
                                        'free': usage.free,
                                        'percent': round((usage.used / usage.total) * 100, 2)
                                    })
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
                output = subprocess.check_output(['du', '-sk', path], timeout=5, stderr=subprocess.DEVNULL)
                return int(output.split()[0]) * 1024
        except:
            pass
        return 0

    def list_directory_details_streaming(self, root_path: str):
        """流式列出目录内容"""
        try:
            root_path_abs = str(Path(root_path).resolve())
            entries = []
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

            # 1. 立即返回基础结构
            print(json.dumps({
                'type': 'structure',
                'root': root_path_abs,
                'items': entries
            }))

            # 2. 获取根目录及其直接子目录的大小
            size_map = {}
            if self.system != "Windows":
                try:
                    # du -d 1 -k 获取当前层级所有子项大小
                    output = subprocess.check_output(['du', '-d', '1', '-k', root_path_abs], timeout=20, stderr=subprocess.DEVNULL).decode('utf-8')
                    for line in output.splitlines():
                        parts = line.split('\t')
                        if len(parts) == 2:
                            # 规范化路径以匹配
                            p = str(Path(parts[1]).resolve())
                            size_map[p] = int(parts[0]) * 1024
                    
                    if size_map:
                        print(json.dumps({
                            'type': 'size_batch',
                            'sizes': size_map
                        }))
                        return
                except:
                    pass

            # 3. 回退方案：逐个计算并发送
            # 首先计算根目录大小
            root_size = 0
            for entry in entries:
                if entry['is_dir']:
                    print(json.dumps({'type': 'status', 'message': f"正在计算: {entry['name']}"}))
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
                    }))
                else:
                    root_size += entry['size']
            
            # 发送根目录最终大小
            print(json.dumps({
                'type': 'size_update',
                'path': root_path_abs,
                'size': root_size
            }))

        except Exception as e:
            print(json.dumps({'type': 'error', 'message': str(e)}))

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
