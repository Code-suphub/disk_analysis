import os
import json
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional

class DiskScanner:
    def __init__(self):
        self.total_files = 0
        self.processed_files = 0
        self.start_time = 0
        self.last_update_time = 0
        self.update_interval = 0.5  # Send updates every 0.5 seconds

    def get_file_info(self, path: str) -> Dict:
        """Get file information including size and modification time."""
        try:
            stat = os.stat(path)
            return {
                'size': stat.st_size,
                'modified': stat.st_mtime,
                'created': stat.st_ctime
            }
        except (OSError, PermissionError):
            return {'size': 0, 'modified': 0, 'created': 0}

    def send_progress_update(self, progress_callback):
        """Send a progress update if enough time has passed since the last update."""
        current_time = time.time()
        if current_time - self.last_update_time >= self.update_interval:
            elapsed_time = current_time - self.start_time
            if self.processed_files > 0:
                files_per_second = self.processed_files / elapsed_time
                remaining_files = self.total_files - self.processed_files
                estimated_remaining = remaining_files / files_per_second if files_per_second > 0 else 0
            else:
                estimated_remaining = 0

            progress = {
                'processed': self.processed_files,
                'total': self.total_files,
                'elapsed': elapsed_time,
                'estimated_remaining': estimated_remaining,
                'percent': (self.processed_files / self.total_files * 100) if self.total_files > 0 else 0
            }
            progress_callback(json.dumps(progress))
            self.last_update_time = current_time

    def scan_directory(self, root_path: str, progress_callback=None) -> Dict:
        """
        Recursively scan a directory and return detailed information about its contents.
        Uses multi-threading for improved performance.
        """
        # First pass: count files
        self.total_files = sum([len(files) for _, _, files in os.walk(root_path)])
        self.processed_files = 0
        self.start_time = time.time()
        self.last_update_time = self.start_time

        if progress_callback:
            progress_callback(json.dumps({
                'status': 'starting',
                'message': 'Counting files...',
                'total': self.total_files
            }))

        def process_directory(path: str) -> Dict:
            try:
                result = {
                    'name': os.path.basename(path) or path,
                    'path': path,
                    'type': 'directory',
                    'children': [],
                    'size': 0,
                    'file_count': 0
                }

                items = os.listdir(path)
                
                with ThreadPoolExecutor() as executor:
                    futures = []
                    
                    for item in items:
                        item_path = os.path.join(path, item)
                        if os.path.isfile(item_path):
                            self.processed_files += 1
                            info = self.get_file_info(item_path)
                            file_data = {
                                'name': item,
                                'path': item_path,
                                'type': 'file',
                                'size': info['size'],
                                'modified': info['modified'],
                                'created': info['created']
                            }
                            result['children'].append(file_data)
                            result['size'] += info['size']
                            result['file_count'] += 1
                            
                            if progress_callback:
                                self.send_progress_update(progress_callback)
                                
                        elif os.path.isdir(item_path):
                            futures.append(executor.submit(process_directory, item_path))

                    # Process subdirectories
                    for future in futures:
                        try:
                            subdir_data = future.result()
                            result['children'].append(subdir_data)
                            result['size'] += subdir_data['size']
                            result['file_count'] += subdir_data['file_count']
                        except Exception as e:
                            # Log error as JSON instead of print
                            if progress_callback:
                                progress_callback(json.dumps({
                                    'status': 'error',
                                    'message': f"Error processing subdirectory: {str(e)}"
                                }))

                return result
            except (PermissionError, OSError) as e:
                return {
                    'name': os.path.basename(path) or path,
                    'path': path,
                    'type': 'error',
                    'error': str(e),
                    'size': 0,
                    'file_count': 0,
                    'children': []
                }

        result = process_directory(root_path)
        
        if progress_callback:
            progress_callback(json.dumps({
                'status': 'complete',
                'processed': self.processed_files,
                'total': self.total_files,
                'elapsed': time.time() - self.start_time
            }))
            
        return result

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        scanner = DiskScanner()
        result = scanner.scan_directory(sys.argv[1])
        print(json.dumps(result))
