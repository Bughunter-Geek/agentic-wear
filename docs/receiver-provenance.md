# Receiver provenance checkpoint

Read-only inspection on 2026-10-14 found the installed receiver manifest at version 0.3.5.2, named Agentic Wear Cloud Receiver. Every installed JavaScript/icon/popup file matched the active release checkout's privacy-corrected working files. Manifest differences were name, description and action title; its version and public key matched. These facts establish current file content, not the installation timeline.

The earlier handoff describing 0.3.14.1 is not corroborated by that current manifest. No receiver replacement, reload, permission change or version change was performed during reconciliation. The native-host bundle matched the active checkout's bundled helper byte-for-byte at this checkpoint; private host/pairing/configuration was retained.

The public receiver ZIP on v0.6.30 internally reports 0.3.5.1 and has SHA-256 a4fc5fb0b77f4ba6c338c7c18307da7103c2e3375fdec192892d123f8b33ec41. This isolated source candidate advances that public source series to 0.3.5.3, adds no default Dot and does not claim to upgrade an existing 0.3.14-series installation. Such installations require an independently reviewed, monotonic in-place maintenance update.

Historical source tags and older cached downloads remain unchanged. Current-source/packaged-source privacy must be verified separately from asset filenames and installed version labels.
