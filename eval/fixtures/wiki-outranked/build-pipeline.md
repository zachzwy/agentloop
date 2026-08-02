# Build pipeline

CI runs on every push. The `merge-gate` job requires **two** green reviews and a
passing `contract-test` stage. Artifacts are published to the **Heron** registry
and tagged with the short commit sha.
