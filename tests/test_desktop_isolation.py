from scripts.verify_desktop_isolation import source_digest


def test_source_digest_handles_windows_checkout_without_ignoring_edits(tmp_path):
    source = tmp_path / 'layout.tsx'
    source.write_bytes(b'export default App;\n')
    baseline = source_digest(source)
    source.write_bytes(b'export default App;\r\n')
    assert source_digest(source) == baseline
    source.write_bytes(b'export default Other;\r\n')
    assert source_digest(source) != baseline


def test_source_digest_preserves_binary_bytes(tmp_path):
    source = tmp_path / 'font.woff2'
    source.write_bytes(b'\r\n')
    baseline = source_digest(source)
    source.write_bytes(b'\n')
    assert source_digest(source) != baseline
