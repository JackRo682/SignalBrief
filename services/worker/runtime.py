import asyncio
from dataclasses import dataclass, field
from time import monotonic


@dataclass
class Runtime:
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    started: asyncio.Event = field(default_factory=asyncio.Event)
    last_heartbeat: float | None = None

    def is_alive(self) -> bool:
        return (
            not self.stop.is_set()
            and self.last_heartbeat is not None
            and monotonic() - self.last_heartbeat < 2.0
        )

    async def run(self) -> None:
        # No job execution, provider access or external dependency is implemented here.
        while not self.stop.is_set():
            self.last_heartbeat = monotonic()
            self.started.set()
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=0.25)
            except TimeoutError:
                pass
