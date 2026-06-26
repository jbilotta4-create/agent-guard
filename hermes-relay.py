#!/usr/bin/env python3
"""
Hermes → Shi 文件传输服务
Hermes通过POST请求发送文本内容，存储到指定目录供Shi消费。
"""

import json
import os
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

STORAGE_DIR = "/root/.openclaw/workspace/hermes-inbox"
AUTH_TOKEN = "b7a461107ae0989b23cfc0c7cf34f182839af5a71097d7e2"
PORT = 18790

os.makedirs(STORAGE_DIR, exist_ok=True)


class HermesHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        # Auth check
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {AUTH_TOKEN}":
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "unauthorized"}).encode())
            return

        # Read body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "invalid json"}).encode())
            return

        # Validate required fields
        text = data.get("text", "")
        filename = data.get("filename", "")
        metadata = data.get("metadata", {})

        if not text:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "missing 'text' field"}).encode())
            return

        # Generate filename if not provided
        if not filename:
            today = datetime.now().strftime("%Y-%m-%d")
            existing = len([f for f in os.listdir(STORAGE_DIR) if f.startswith(f"hermes-delivery-{today}")])
            filename = f"hermes-delivery-{today}-{existing+1:03d}.txt"

        # Write file
        filepath = os.path.join(STORAGE_DIR, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            if metadata:
                f.write("=== 元数据 ===\n")
                for k, v in metadata.items():
                    f.write(f"{k}: {v}\n")
                f.write("\n")
            f.write(text)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "status": "ok",
            "filename": filename,
            "path": filepath
        }).encode())

    def do_GET(self):
        """Health check"""
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            files = os.listdir(STORAGE_DIR)
            self.wfile.write(json.dumps({"status": "ok", "files": len(files)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging
        pass


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), HermesHandler)
    print(f"Hermes relay listening on 127.0.0.1:{PORT}")
    server.serve_forever()
