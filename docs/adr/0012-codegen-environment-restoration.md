# Own codegen restoration across the complete operation

Accepted for [#164](https://github.com/panzacoder/zodvex/issues/164), 2026-10-05.
One internal owner restores discovery stubs on every exit and rolls back all eight
generated outputs on failure, including partial setup and output-write failures;
restoration failures are reported alongside the original failure after attempting
all cleanup. This stronger guarantee avoids mixed generations while preserving
successful output and public interfaces, but provides neither crash recovery nor
atomic visibility to concurrent readers; loader registration and module caches
remain process-lifetime state, requiring a fresh process for a different project.
