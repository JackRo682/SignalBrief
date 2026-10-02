import json


class BodyLimitMiddleware:
    """ASGI streaming request limit, including requests without Content-Length."""

    def __init__(self, app, limit=32768):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in ("POST", "PUT", "PATCH"):
            return await self.app(scope, receive, send)
        chunks, total = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            total += len(message.get("body", b""))
            if total > self.limit:
                payload = json.dumps(
                    {"error": {"code": "request_body_too_large", "message": "입력이 너무 큽니다."}}
                ).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")],
                    }
                )
                await send({"type": "http.response.body", "body": payload})
                return
            chunks.append(message)
            if not message.get("more_body", False):
                break
        index = 0

        async def replay():
            nonlocal index
            if index < len(chunks):
                value = chunks[index]
                index += 1
                return value
            return await receive()

        await self.app(scope, replay, send)
