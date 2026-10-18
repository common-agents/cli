# Releasing

Releases are versioned with [since](https://github.com/release-tools/since) and published to npm by GitHub Actions using [trusted publishing](https://docs.npmjs.com/trusted-publishers).

To release a new version, run:

```bash
since project release && git push origin main --tags
```
