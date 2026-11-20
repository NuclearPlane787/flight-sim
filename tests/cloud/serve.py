# A static server for the cloud container's copy of GameDump, with no caching, so a re-staged
# module is always the one served. Run from anywhere:
#   python3 serve.py /mnt/user-data/uploads/GameDump        (serves http://127.0.0.1:8765/)
import functools, http.server, sys

class NoStore(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1, so a browser keeps its connections (2026-11-21: with HTTP/1.0's one connection a file, a night of
    # checks over thousands of tile files left 17,000 sockets in TIME_WAIT, more than the Mac has local ports, and
    # pages began to log net::ERR_ADDRESS_INVALID).
    protocol_version = 'HTTP/1.1'
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

root = sys.argv[1] if len(sys.argv) > 1 else '.'
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(NoStore, directory=root)).serve_forever()
