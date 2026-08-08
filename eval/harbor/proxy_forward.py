#!/usr/bin/env python3
"""Expose a loopback-only host proxy to Docker containers.

The user's proxy (e.g. Clash) typically listens on 127.0.0.1 only, which
containers cannot reach. This forwarder listens on 0.0.0.0 and pipes to the
loopback proxy; containers then use http://172.17.0.1:4396 (the docker0
bridge gateway) as their proxy.

Usage:
    python3 proxy_forward.py [listen_port] [target_host:target_port]

Defaults: listen 0.0.0.0:4396 -> 127.0.0.1:4395.
"""

import asyncio
import signal
import sys

LISTEN_HOST = "0.0.0.0"
DEFAULT_LISTEN_PORT = 4396
DEFAULT_TARGET = ("127.0.0.1", 4395)


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def handle(reader, writer):
    try:
        up_reader, up_writer = await asyncio.open_connection(*TARGET)
    except OSError:
        writer.close()
        return
    await asyncio.gather(pipe(reader, up_writer), pipe(up_reader, writer))


async def main():
    global TARGET
    listen_port = DEFAULT_LISTEN_PORT
    target = DEFAULT_TARGET
    if len(sys.argv) > 1:
        listen_port = int(sys.argv[1])
    if len(sys.argv) > 2:
        host, _, port = sys.argv[2].partition(":")
        target = (host, int(port))
    TARGET = target

    # Refuse to start if the upstream proxy isn't listening; fail loudly
    # instead of silently dropping container traffic.
    probe = asyncio.open_connection(*TARGET)
    try:
        await asyncio.wait_for(probe, timeout=3)
        probe.close()
    except (OSError, asyncio.TimeoutError) as e:
        print(f"error: upstream proxy {TARGET[0]}:{TARGET[1]} unreachable: {e}", file=sys.stderr)
        sys.exit(1)

    server = await asyncio.start_server(handle, LISTEN_HOST, listen_port)
    print(
        f"forwarding {LISTEN_HOST}:{listen_port} -> {TARGET[0]}:{TARGET[1]}",
        flush=True,
    )
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            asyncio.get_running_loop().add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass
    async with server:
        await stop.wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
