#!/usr/bin/env python3
"""Local test server for the browser suite. Serves the repo root, with three changes:

  * index.html is served with the supabase-js <script> swapped for
    tests/mock_supabase.js, so nothing in a test run can reach the real database
    (add ?nosb=1 to drop the script entirely = "the library failed to load").
    Google Fonts is stripped too -- tests make no outside requests at all.
  * /__test/<file>          serves files from tests/
  * /__test/ctl?fail=<sub>  makes any path containing <sub> return 503 (fail= clears)
    /__test/ctl?drop=1      hangs up on every non-test request = "no network" (drop=0 clears)
    /__test/ctl?slow=<ms>   delays every non-test request (slow=0 clears)
    /__test/ctl?raw=1       serves index.html with the real sync library, not the mock
                            (only for the service-worker run, where the browser is
                            started with all outside hosts blocked)
    /__test/ctl?reset=1     clears the request log and all of the above
    /__test/log             JSON {path: hits} since the last reset
    /__test/report          POST stores a result, GET returns it (service-worker run)

Usage: server.py <port>
"""
import json, pathlib, re, socket, sys, threading, time, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests'
SB_TAG = re.compile(r'<script src="[^"]*supabase[^"]*"></script>')
FONT_TAG = re.compile(r'<link[^>]*fonts\.googleapis\.com[^>]*>\n?')
state = {'fail': '', 'drop': False, 'slow': 0, 'raw': False, 'log': {}, 'report': ''}
lock = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, *a):
        pass

    def send_bytes(self, body, ctype, status=200):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def send_head(self):
        self.no_store = True  # static files: never let WebKit's HTTP cache hide a request from the log
        return super().send_head()

    def end_headers(self):
        if getattr(self, 'no_store', False):
            self.send_header('Cache-Control', 'no-store')
            self.no_store = False
        super().end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(url.query, keep_blank_values=True)
        path = url.path
        if path == '/__test/ctl':
            with lock:
                if 'fail' in qs:
                    state['fail'] = qs['fail'][0]
                if 'drop' in qs:
                    state['drop'] = qs['drop'][0] == '1'
                if 'slow' in qs:
                    state['slow'] = int(qs['slow'][0])
                if 'raw' in qs:
                    state['raw'] = qs['raw'][0] == '1'
                if 'reset' in qs:
                    state.update(fail='', drop=False, slow=0, raw=False, log={})
            return self.send_bytes(b'ok', 'text/plain')
        if path == '/__test/report':
            return self.send_bytes(state['report'].encode(), 'application/json')
        if path == '/__test/log':
            with lock:
                return self.send_bytes(json.dumps(state['log']).encode(), 'application/json')
        if path.startswith('/__test/'):
            f = TESTS / path[len('/__test/'):]
            if f.is_file() and TESTS in f.resolve().parents:
                return self.send_bytes(f.read_bytes(), 'text/html; charset=utf-8' if f.suffix == '.html' else 'text/javascript')
            return self.send_bytes(b'not found', 'text/plain', 404)
        with lock:
            state['log'][path] = state['log'].get(path, 0) + 1
            failing = state['fail'] and state['fail'] in path
            drop, slow, raw = state['drop'], state['slow'], state['raw']
        if drop:
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            return
        if slow:
            time.sleep(slow / 1000)
        if failing:
            return self.send_bytes(b'injected failure', 'text/plain', 503)
        if path in ('/', '/index.html'):
            html = (ROOT / 'index.html').read_text(encoding='utf-8')
            mock = '' if 'nosb' in qs else '<script src="/__test/mock_supabase.js"></script>'
            n = len(SB_TAG.findall(html))
            if not raw:
                html = SB_TAG.sub(mock, html)
            if n != 1:
                return self.send_bytes(b'test server: supabase script tag not found exactly once', 'text/plain', 500)
            html = FONT_TAG.sub('', html)
            return self.send_bytes(html.encode('utf-8'), 'text/html; charset=utf-8')
        return super().do_GET()


    def do_POST(self):
        if self.path == '/__test/report':
            state['report'] = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
            return self.send_bytes(b'ok', 'text/plain')
        self.send_bytes(b'not found', 'text/plain', 404)


if __name__ == '__main__':
    port = int(sys.argv[1])
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
