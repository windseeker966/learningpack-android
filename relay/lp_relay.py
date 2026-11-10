#!/usr/bin/env python3
"""LearningPack 中转服务器：手机和 iPad 不在同一个网络时，借它交换加密过的数据块（协议见 ../PROTOCOL.md 的「中转」）。

只是一个信箱：按信箱号存取数据块，不认识内容（都在设备上用配对密钥加密过）。只用 Python 标准库。
用法：python3 lp_relay.py [--port 47322] [--dir /var/lib/lp-relay]
"""
import argparse
import json
import os
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BLOCK = 16 * 1024 * 1024
KEEP_DAYS = 30
BOX = r'[0-9a-f]{32}'
SHA = r'[0-9a-f]{64}'
ROUTES = re.compile(rf'^/box/(?P<box>{BOX})/(?:(?P<slot>up|down|study)|img/(?P<sha>{SHA})|(?P<missing>missing))$')

ROOT = '/var/lib/lp-relay'


def path_of(box, slot=None, sha=None):
    if sha:
        return os.path.join(ROOT, box, 'img', sha)
    return os.path.join(ROOT, box, slot)


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
    with os.fdopen(fd, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'lp-relay'

    def log_message(self, fmt, *args):
        # 只记方法、路径前缀和状态，不记信箱号
        pass

    def reply(self, status, body=b'', content_type='application/octet-stream', etag=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        if etag:
            self.send_header('ETag', etag)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Connection', 'close')
        self.end_headers()
        if body:
            self.wfile.write(body)
        self.close_connection = True

    def read_body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length < 0 or length > MAX_BLOCK:
            return None
        return self.rfile.read(length)

    def route(self):
        m = ROUTES.match(self.path)
        return m.groupdict() if m else None

    def do_GET(self):
        if self.path == '/ping':
            return self.reply(200, b'ok', 'text/plain')
        r = self.route()
        if not r or r['missing']:
            return self.reply(404)
        try:
            with open(path_of(r['box'], r['slot'], r['sha']), 'rb') as f:
                st = os.fstat(f.fileno())
                # 内容没变（ETag 一样）时只回 304，手机定时来取题单时不用每次都下载
                etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
                if self.headers.get('If-None-Match') == etag:
                    return self.reply(304, etag=etag)
                data = f.read()
        except FileNotFoundError:
            return self.reply(404)
        self.reply(200, data, etag=etag)

    def do_PUT(self):
        r = self.route()
        if not r or r['missing']:
            return self.reply(404)
        data = self.read_body()
        if data is None:
            return self.reply(413)
        if len(data) < 28:   # nonce + tag 都放不下，不是加密过的块
            return self.reply(400)
        write_atomic(path_of(r['box'], r['slot'], r['sha']), data)
        self.reply(204)

    def do_POST(self):
        r = self.route()
        if not r or not r['missing']:
            return self.reply(404)
        data = self.read_body()
        try:
            shas = json.loads(data or b'[]')
            assert isinstance(shas, list) and all(isinstance(s, str) and re.fullmatch(SHA, s) for s in shas)
        except Exception:
            return self.reply(400)
        missing = []
        for sha in shas:
            p = path_of(r['box'], sha=sha)
            if os.path.exists(p):
                os.utime(p)   # 还在用：延长保存期
            else:
                missing.append(sha)
        self.reply(200, json.dumps({'missing': missing}).encode(), 'application/json')


def cleanup_loop():
    while True:
        cutoff = time.time() - KEEP_DAYS * 86400
        for dirpath, dirnames, filenames in os.walk(ROOT, topdown=False):
            for name in filenames:
                p = os.path.join(dirpath, name)
                try:
                    if os.path.getmtime(p) < cutoff:
                        os.remove(p)
                except OSError:
                    pass
            if dirpath != ROOT and not os.listdir(dirpath):
                try:
                    os.rmdir(dirpath)
                except OSError:
                    pass
        time.sleep(6 * 3600)


def main():
    global ROOT
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=47322)
    ap.add_argument('--dir', default=os.environ.get('STATE_DIRECTORY', ROOT))
    args = ap.parse_args()
    ROOT = args.dir
    os.makedirs(ROOT, exist_ok=True)
    threading.Thread(target=cleanup_loop, daemon=True).start()
    server = ThreadingHTTPServer(('', args.port), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == '__main__':
    main()
