class ProviderError(RuntimeError):
    def __init__(self, code: str, retryable: bool = False, retry_after: float | None = None):
        self.code, self.retryable, self.retry_after = code, retryable, retry_after
        super().__init__(code)


class QuotaExceeded(ProviderError):
    pass


class ContentChanged(ProviderError):
    pass


class ParseError(RuntimeError):
    pass


class EvidenceError(RuntimeError):
    pass


class LostLease(RuntimeError):
    pass
