from ..http_client import SafeHTTP
from ..limits import ProviderLimiter
from .base import DocumentDescriptor as DocumentDescriptor
from .base import Provider as Provider
from .dart import DartProvider
from .sec import SecProvider


def make_provider(settings, factory, name):
    if name == "dart":
        limiter = ProviderLimiter(factory, "dart", settings.dart_requests_per_second)
        return DartProvider(settings, SafeHTTP(settings, limiter))
    if name == "sec":
        limiter = ProviderLimiter(factory, "sec", settings.sec_requests_per_second)
        return SecProvider(settings, SafeHTTP(settings, limiter))
    raise ValueError("Supported live providers: dart, sec")
