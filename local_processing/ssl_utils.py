"""
Inject Windows certificate store into Python ssl so corporate proxy certs are trusted.
Call inject() once at the top of any script that makes HTTPS requests.
"""
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass  # truststore not installed — falls back to certifi/default
